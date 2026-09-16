import mongoose from "mongoose";

import env from "../config/environment.js";

const PRODUCT_ID = "6a706ae7075a44eb73a7c6f5";

const VARIANT_IDS = ["6a706ae7075a44eb73a7c6f8", "6a706ae7075a44eb73a7c6f9"];

const ROW_LIMIT = 100;
const MAX_TIME_MS = 30_000;

const idString = (value) =>
  value?._bsontype === "ObjectId" ? value.toHexString() : null;

const matchingItems = (items, productId, variantId) =>
  Array.isArray(items)
    ? items.filter(
        (item) =>
          idString(item?.product) === productId &&
          idString(item?.variantId) === variantId,
      )
    : [];

const readRows = async (database, collection, filter, projection, session) => {
  const rows = await database
    .collection(collection)
    .find(filter, {
      projection,
      session,
      maxTimeMS: MAX_TIME_MS,
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(ROW_LIMIT + 1)
    .toArray();

  return {
    truncated: rows.length > ROW_LIMIT,
    rows: rows.slice(0, ROW_LIMIT),
  };
};

const inspectSnapshot = async (database, session) => {
  const productObjectId = new mongoose.Types.ObjectId(PRODUCT_ID);

  const product = await database.collection("products").findOne(
    { _id: productObjectId },
    {
      session,
      maxTimeMS: MAX_TIME_MS,
      projection: {
        _id: 1,
        "variants._id": 1,
        "variants.inventory.stock": 1,
        "variants.inventory.reservedStock": 1,
      },
    },
  );

  const results = [];

  for (const variantId of VARIANT_IDS) {
    const variantObjectId = new mongoose.Types.ObjectId(variantId);

    const itemFilter = {
      items: {
        $elemMatch: {
          product: productObjectId,
          variantId: variantObjectId,
        },
      },
    };

    const variant = Array.isArray(product?.variants)
      ? product.variants.find((entry) => idString(entry?._id) === variantId)
      : undefined;

    // Read sequentially: these queries share one transaction.
    const ledger = await readRows(
      database,
      "productinventoryledgers",
      {
        product: productObjectId,
        variantId: variantObjectId,
      },
      {
        _id: 1,
        createdAt: 1,
        operation: 1,
        quantity: 1,
        stockDelta: 1,
        reservedStockDelta: 1,
        "before.stock": 1,
        "before.reservedStock": 1,
        "after.stock": 1,
        "after.reservedStock": 1,
        referenceId: 1,
        actorType: 1,
        systemActor: 1,
      },
      session,
    );

    const orders = await readRows(
      database,
      "orders",
      itemFilter,
      {
        _id: 1,
        createdAt: 1,
        orderNumber: 1,
        status: 1,
        inventoryStatus: 1,
        inventoryReservationExpiresAt: 1,
        "items.product": 1,
        "items.variantId": 1,
        "items.quantity": 1,
        "items.inventory": 1,
      },
      session,
    );

    const replacements = await readRows(
      database,
      "orderreturnreplacements",
      itemFilter,
      {
        _id: 1,
        createdAt: 1,
        replacementNumber: 1,
        status: 1,
        "items.product": 1,
        "items.variantId": 1,
        "items.replacementQuantity": 1,
      },
      session,
    );

    results.push({
      productId: PRODUCT_ID,
      variantId,
      productExists: Boolean(product),
      variantExists: Boolean(variant),
      currentInventory: variant?.inventory ?? null,

      orders: {
        truncated: orders.truncated,
        records: orders.rows.map((order) => ({
          id: idString(order._id),
          orderNumber: order.orderNumber ?? null,
          createdAt: order.createdAt ?? null,
          status: order.status ?? null,
          inventoryStatus: order.inventoryStatus ?? null,
          reservationExpiresAt: order.inventoryReservationExpiresAt ?? null,
          matchingItems: matchingItems(order.items, PRODUCT_ID, variantId).map(
            (item) => ({
              quantity: item.quantity ?? null,
              inventory: item.inventory ?? null,
            }),
          ),
        })),
      },

      replacements: {
        truncated: replacements.truncated,
        records: replacements.rows.map((replacement) => ({
          id: idString(replacement._id),
          replacementNumber: replacement.replacementNumber ?? null,
          createdAt: replacement.createdAt ?? null,
          status: replacement.status ?? null,
          matchingItems: matchingItems(
            replacement.items,
            PRODUCT_ID,
            variantId,
          ).map((item) => ({
            replacementQuantity: item.replacementQuantity ?? null,
          })),
        })),
      },

      ledger: {
        truncated: ledger.truncated,
        displayOrder: "oldest-to-newest-within-latest-100",
        records: [...ledger.rows].reverse().map((entry) => ({
          id: idString(entry._id),
          createdAt: entry.createdAt ?? null,
          operation: entry.operation ?? null,
          quantity: entry.quantity ?? null,
          stockDelta: entry.stockDelta ?? null,
          reservedStockDelta: entry.reservedStockDelta ?? null,
          before: entry.before ?? null,
          after: entry.after ?? null,
          referenceId: entry.referenceId ?? null,
          actorType: entry.actorType ?? null,
          systemActor: entry.systemActor ?? null,
        })),
      },
    });
  }

  return {
    mode: "read-only",
    database: database.databaseName,
    consistency: "snapshot",
    status: "diagnostic-complete",
    rowLimitPerSection: ROW_LIMIT,
    results,
  };
};

let connection;

try {
  connection = mongoose.createConnection(env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 2,
  });

  await connection.asPromise();

  const database = connection.db;

  for (const name of [
    "products",
    "orders",
    "orderreturnreplacements",
    "productinventoryledgers",
  ]) {
    const exists = await database
      .listCollections({ name }, { nameOnly: true })
      .hasNext();

    if (!exists) {
      throw new Error("A required diagnostic collection is absent");
    }
  }

  const session = connection.getClient().startSession();

  try {
    const report = await session.withTransaction(
      () => inspectSnapshot(database, session),
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
        maxCommitTimeMS: 10_000,
      },
    );

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await session.endSession();
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        mode: "read-only",
        status: "diagnostic-failed",
        code: typeof error?.code === "number" ? error.code : null,
        message:
          "Could not complete the diagnostic. Check required collections, connectivity, read permissions, and transaction support.",
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
} finally {
  if (connection) {
    try {
      await connection.close();
    } catch (error) {
      const redact = (value) =>
        String(value).replace(
          /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
          "[REDACTED_MONGODB_URI]",
        );

      console.error(
        JSON.stringify(
          {
            mode: "read-only",
            status: "diagnostic-failed",
            errorName: error?.name ?? "UnknownError",
            code: error?.code ?? null,
            message: redact(error?.message ?? "Unknown error"),
            location: String(error?.stack ?? "")
              .split("\n")
              .filter((line) => /^\s+at\s/.test(line))
              .slice(0, 4)
              .map(redact),
          },
          null,
          2,
        ),
      );

      process.exitCode = 2;
    }
  }
}
