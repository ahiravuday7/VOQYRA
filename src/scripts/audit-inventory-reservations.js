import mongoose from "mongoose";

import env from "../config/environment.js";

const SAMPLE_LIMIT = 20;
const MAX_TIME_MS = 30_000;

const ORDER_INVENTORY_STATUSES = new Set([
  "pending",
  "reserved",
  "committed",
  "released",
]);

const REPLACEMENT_STATUSES = new Set([
  "pending",
  "reserved",
  "processing",
  "shipped",
  "delivered",
  "failed",
  "cancelled",
]);

const HELD_REPLACEMENT_STATUSES = new Set(["reserved", "processing"]);

const isObjectId = (value) => value?._bsontype === "ObjectId";

const objectIdString = (value) =>
  isObjectId(value) ? value.toHexString() : null;

const isNonNegativeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const addSafely = (left, right) => {
  const result = left + right;

  if (!Number.isSafeInteger(result)) {
    throw new Error("Inventory audit quantity exceeds safe integer range");
  }

  return result;
};

const createReport = (databaseName) => ({
  mode: "read-only",
  database: databaseName,
  scope: "inventory-reservations-against-orders-and-replacements",
  consistency: "snapshot",
  status: "pass",
  summary: {
    ordersScanned: 0,
    replacementsScanned: 0,
    productsScanned: 0,
    variantsScanned: 0,
    orderReservedUnits: 0,
    replacementReservedUnits: 0,
    storedReservedUnits: 0,
    variantsCompared: 0,
    variantsWithReservationDifference: 0,
    outstandingReferencesNotFound: 0,
    issueCount: 0,
    issuesByCode: {},
  },
  sampleLimit: SAMPLE_LIMIT,
  samplesTruncated: false,
  samples: [],
  findings: [],
});

const addIssue = (report, code, details = {}) => {
  report.summary.issueCount += 1;

  report.summary.issuesByCode[code] =
    (report.summary.issuesByCode[code] ?? 0) + 1;

  if (report.samples.length < SAMPLE_LIMIT) {
    report.samples.push({
      issueCode: code,
      ...details,
    });
  } else {
    report.samplesTruncated = true;
  }
};

const scan = async (database, name, projection, session, inspect) => {
  const cursor = database.collection(name).find(
    {},
    {
      projection,
      session,
      batchSize: 100,
      maxTimeMS: MAX_TIME_MS,
    },
  );

  try {
    for await (const document of cursor) {
      inspect(document);
    }
  } finally {
    await cursor.close();
  }
};

const auditSnapshot = async (database, session) => {
  const report = createReport(database.databaseName);
  const reservations = new Map();

  const addReservation = (item, quantity, source, details) => {
    if (
      !isObjectId(item?.product) ||
      !isObjectId(item?.variantId) ||
      !isPositiveInteger(quantity)
    ) {
      addIssue(report, "INVALID_OUTSTANDING_RESERVATION", details);
      return;
    }

    const productId = item.product.toHexString();
    const variantId = item.variantId.toHexString();
    const key = `${productId}:${variantId}`;

    const entry = reservations.get(key) ?? {
      productId,
      variantId,
      orderUnits: 0,
      replacementUnits: 0,
    };

    entry[source] = addSafely(entry[source], quantity);

    reservations.set(key, entry);

    const totalField =
      source === "orderUnits"
        ? "orderReservedUnits"
        : "replacementReservedUnits";

    report.summary[totalField] = addSafely(
      report.summary[totalField],
      quantity,
    );
  };

  await scan(
    database,
    "orders",
    {
      _id: 1,
      inventoryStatus: 1,
      "items.product": 1,
      "items.variantId": 1,
      "items.quantity": 1,
      "items.inventory": 1,
    },
    session,
    (order) => {
      report.summary.ordersScanned += 1;

      const documentId = objectIdString(order._id);

      if (!ORDER_INVENTORY_STATUSES.has(order.inventoryStatus)) {
        addIssue(report, "INVALID_ORDER_INVENTORY_STATUS", {
          collection: "orders",
          documentId,
        });
      }

      if (!Array.isArray(order.items) || order.items.length === 0) {
        addIssue(report, "INVALID_ORDER_ITEMS", {
          collection: "orders",
          documentId,
        });
        return;
      }

      order.items.forEach((item, itemIndex) => {
        const details = {
          collection: "orders",
          documentId,
          itemIndex,
        };

        const inventory = item?.inventory;
        const status = inventory?.status;
        const quantity = item?.quantity;

        if (
          !ORDER_INVENTORY_STATUSES.has(status) ||
          status !== order.inventoryStatus
        ) {
          addIssue(report, "ORDER_ITEM_INVENTORY_STATUS_INVALID", details);
        }

        const expectedReserved = status === "reserved" ? quantity : 0;
        const expectedCommitted = status === "committed" ? quantity : 0;
        const expectedReleased = status === "released" ? quantity : 0;

        if (
          !isPositiveInteger(quantity) ||
          !isNonNegativeInteger(inventory?.reservedQuantity) ||
          !isNonNegativeInteger(inventory?.committedQuantity) ||
          !isNonNegativeInteger(inventory?.releasedQuantity) ||
          inventory?.reservedQuantity !== expectedReserved ||
          inventory?.committedQuantity !== expectedCommitted ||
          inventory?.releasedQuantity !== expectedReleased
        ) {
          addIssue(report, "ORDER_ITEM_INVENTORY_QUANTITIES_INVALID", details);
        }

        // Count the stored outstanding quantity. Invalid state is
        // reported separately rather than silently treated as valid.
        if (isPositiveInteger(inventory?.reservedQuantity)) {
          addReservation(
            item,
            inventory.reservedQuantity,
            "orderUnits",
            details,
          );
        }
      });
    },
  );

  await scan(
    database,
    "orderreturnreplacements",
    {
      _id: 1,
      status: 1,
      "items.product": 1,
      "items.variantId": 1,
      "items.replacementQuantity": 1,
    },
    session,
    (replacement) => {
      report.summary.replacementsScanned += 1;

      const documentId = objectIdString(replacement._id);

      if (!REPLACEMENT_STATUSES.has(replacement.status)) {
        addIssue(report, "INVALID_REPLACEMENT_STATUS", {
          collection: "orderreturnreplacements",
          documentId,
        });
        return;
      }

      if (!HELD_REPLACEMENT_STATUSES.has(replacement.status)) {
        return;
      }

      if (!Array.isArray(replacement.items) || replacement.items.length === 0) {
        addIssue(report, "INVALID_RESERVED_REPLACEMENT_ITEMS", {
          collection: "orderreturnreplacements",
          documentId,
        });
        return;
      }

      replacement.items.forEach((item, itemIndex) => {
        addReservation(item, item?.replacementQuantity, "replacementUnits", {
          collection: "orderreturnreplacements",
          documentId,
          itemIndex,
        });
      });
    },
  );

  const productIds = new Set();
  const seenVariants = new Set();

  await scan(
    database,
    "products",
    {
      _id: 1,
      "variants._id": 1,
      "variants.inventory.stock": 1,
      "variants.inventory.reservedStock": 1,
    },
    session,
    (product) => {
      report.summary.productsScanned += 1;

      const productId = objectIdString(product._id);

      if (!productId || !Array.isArray(product.variants)) {
        addIssue(report, "INVALID_PRODUCT_VARIANT_STRUCTURE", {
          collection: "products",
          documentId: productId,
        });
        return;
      }

      productIds.add(productId);

      product.variants.forEach((variant, variantIndex) => {
        report.summary.variantsScanned += 1;

        const variantId = objectIdString(variant?._id);
        const details = { productId, variantId, variantIndex };

        if (!variantId) {
          addIssue(report, "INVALID_VARIANT_ID", details);
          return;
        }

        const key = `${productId}:${variantId}`;

        if (seenVariants.has(key)) {
          addIssue(report, "DUPLICATE_VARIANT_ID", details);
          return;
        }

        seenVariants.add(key);

        const entry = reservations.get(key);
        const orderUnits = entry?.orderUnits ?? 0;
        const replacementUnits = entry?.replacementUnits ?? 0;
        const expected = addSafely(orderUnits, replacementUnits);

        const stock = variant.inventory?.stock;
        const stored = variant.inventory?.reservedStock;

        if (
          !isNonNegativeInteger(stock) ||
          !isNonNegativeInteger(stored) ||
          stored > stock
        ) {
          addIssue(report, "INVALID_VARIANT_INVENTORY", details);
        }

        if (!isNonNegativeInteger(stored)) {
          return;
        }

        report.summary.storedReservedUnits = addSafely(
          report.summary.storedReservedUnits,
          stored,
        );

        report.summary.variantsCompared += 1;

        if (stored !== expected) {
          report.summary.variantsWithReservationDifference += 1;

          addIssue(
            report,
            stored < expected
              ? "RESERVED_STOCK_BELOW_TRACKED_RESERVATIONS"
              : "RESERVED_STOCK_ABOVE_TRACKED_RESERVATIONS",
            {
              ...details,
              storedReservedStock: stored,
              orderReservedUnits: orderUnits,
              replacementReservedUnits: replacementUnits,
              expectedReservedStock: expected,
              difference: stored - expected,
            },
          );
        }
      });
    },
  );

  for (const [key, entry] of reservations) {
    if (seenVariants.has(key)) {
      continue;
    }

    report.summary.outstandingReferencesNotFound += 1;

    addIssue(
      report,
      productIds.has(entry.productId)
        ? "RESERVED_VARIANT_NOT_FOUND"
        : "RESERVED_PRODUCT_NOT_FOUND",
      entry,
    );
  }

  if (report.summary.issueCount > 0) {
    report.status = "needs-attention";
    report.findings.push(
      "Inventory reservation differences or invalid source data require review.",
    );
  }

  if (
    report.summary.issuesByCode["RESERVED_STOCK_ABOVE_TRACKED_RESERVATIONS"]
  ) {
    report.findings.push(
      "Extra reserved stock may represent direct admin reservations. Review inventory ledger evidence before changing stock.",
    );
  }

  return report;
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
  const missingCollections = [];

  for (const name of ["orders", "orderreturnreplacements", "products"]) {
    const exists = await database
      .listCollections({ name }, { nameOnly: true })
      .hasNext();

    if (!exists) {
      missingCollections.push(name);
    }
  }

  let report;

  if (missingCollections.length > 0) {
    report = {
      mode: "read-only",
      database: database.databaseName,
      status: "needs-attention",
      findings: missingCollections.map(
        (name) => `Required collection is absent: ${name}`,
      ),
    };
  } else {
    const session = connection.getClient().startSession();

    try {
      report = await session.withTransaction(
        () => auditSnapshot(database, session),
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          readPreference: "primary",
          maxCommitTimeMS: 10_000,
        },
      );
    } finally {
      await session.endSession();
    }
  }

  console.log(JSON.stringify(report, null, 2));

  process.exitCode = report.status === "pass" ? 0 : 1;
} catch (error) {
  console.error(
    JSON.stringify(
      {
        mode: "read-only",
        status: "audit-failed",
        code: typeof error?.code === "number" ? error.code : null,
        message:
          "The audit could not complete. Check database connectivity, read permissions, and snapshot transaction support.",
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
    } catch {
      console.error("The audit database connection could not close cleanly.");
      process.exitCode = 2;
    }
  }
}
