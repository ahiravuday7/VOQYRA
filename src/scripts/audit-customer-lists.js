import mongoose from "mongoose";

import env from "../config/environment.js";

const QUERY_TIMEOUT_MS = 30_000;

const TARGETS = [
  {
    name: "Cart",
    collection: "carts",
    maxItems: 50,
    maxQuantity: 99,
    itemTimestamp: null,
    productIndexRequired: true,
  },
  {
    name: "Wishlist",
    collection: "wishlists",
    maxItems: 100,
    itemTimestamp: "addedAt",
    productIndexRequired: false,
  },
  {
    name: "RecentlyViewed",
    collection: "recentlyvieweds",
    maxItems: 50,
    itemTimestamp: "viewedAt",
    productIndexRequired: false,
  },
];

const isObjectId = (value) => {
  return value?._bsontype === "ObjectId";
};

const isDate = (value) => {
  return value instanceof Date && Number.isFinite(value.getTime());
};

const sameIndexKeys = (actual, expected) => {
  return (
    JSON.stringify(Object.entries(actual ?? {})) ===
    JSON.stringify(Object.entries(expected))
  );
};

const summarizeIndex = (index) => ({
  name: index.name,
  key: index.key,
  unique: index.name === "_id_" || index.unique === true,
  sparse: index.sparse === true,
  hidden: index.hidden === true,
  partialFilterExpression: index.partialFilterExpression ?? null,
});

/*
|--------------------------------------------------------------------------
| Inspect One Raw Document
|--------------------------------------------------------------------------
|
| Return issue codes only. No user IDs or item contents are printed.
|--------------------------------------------------------------------------
*/

const inspectDocument = (document, target) => {
  const issues = new Set();

  if (!isObjectId(document._id)) {
    issues.add("INVALID_DOCUMENT_ID");
  }

  if (!isObjectId(document.user)) {
    issues.add("INVALID_USER_ID");
  }

  if (!Number.isSafeInteger(document.__v) || document.__v < 0) {
    issues.add("INVALID_OR_MISSING_VERSION");
  }

  if (
    !isDate(document.createdAt) ||
    !isDate(document.updatedAt) ||
    document.updatedAt < document.createdAt
  ) {
    issues.add("INVALID_DOCUMENT_TIMESTAMPS");
  }

  if (!Array.isArray(document.items)) {
    issues.add("ITEMS_NOT_ARRAY");
    return issues;
  }

  if (document.items.length > target.maxItems) {
    issues.add("ITEM_LIMIT_EXCEEDED");
  }

  const seenEntries = new Set();
  const seenItemIds = new Set();

  for (const item of document.items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      issues.add("INVALID_ITEM_STRUCTURE");
      continue;
    }

    const validProductId = isObjectId(item.product);

    if (!validProductId) {
      issues.add("INVALID_PRODUCT_ID");
    }

    let entryKey = null;

    if (target.name === "Cart") {
      const validVariantId = isObjectId(item.variantId);

      if (!validVariantId) {
        issues.add("INVALID_VARIANT_ID");
      }

      if (
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > target.maxQuantity
      ) {
        issues.add("INVALID_CART_QUANTITY");
      }

      if (!isObjectId(item._id)) {
        issues.add("INVALID_CART_ITEM_ID");
      } else {
        const itemId = String(item._id);

        if (seenItemIds.has(itemId)) {
          issues.add("DUPLICATE_CART_ITEM_ID");
        }

        seenItemIds.add(itemId);
      }

      if (
        !isDate(item.createdAt) ||
        !isDate(item.updatedAt) ||
        item.updatedAt < item.createdAt
      ) {
        issues.add("INVALID_CART_ITEM_TIMESTAMPS");
      }

      if (validProductId && validVariantId) {
        entryKey = `${item.product}:${item.variantId}`;
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(item, "_id")) {
        issues.add("UNEXPECTED_ITEM_ID");
      }

      if (!isDate(item[target.itemTimestamp])) {
        issues.add("INVALID_ITEM_TIMESTAMP");
      }

      if (validProductId) {
        entryKey = String(item.product);
      }
    }

    if (entryKey !== null) {
      if (seenEntries.has(entryKey)) {
        issues.add("DUPLICATE_PRODUCT_OR_VARIANT_ENTRY");
      }

      seenEntries.add(entryKey);
    }
  }

  return issues;
};

/*
|--------------------------------------------------------------------------
| Audit Collection
|--------------------------------------------------------------------------
*/

const auditCollection = async (connection, target) => {
  const exists = await connection.db
    .listCollections({ name: target.collection }, { nameOnly: true })
    .hasNext();

  if (!exists) {
    return {
      model: target.name,
      collection: target.collection,
      collectionExists: false,
      status: "needs-attention",
      findings: [
        "Collection is absent; its required indexes are not installed.",
      ],
    };
  }

  const collection = connection.db.collection(target.collection);

  const indexes = await collection.indexes();

  const uniqueUserIndex = indexes.find(
    (index) =>
      sameIndexKeys(index.key, { user: 1 }) &&
      index.unique === true &&
      index.sparse !== true &&
      !index.partialFilterExpression,
  );

  const productIndex = indexes.find(
    (index) =>
      sameIndexKeys(index.key, { "items.product": 1 }) &&
      index.hidden !== true &&
      !index.partialFilterExpression &&
      index.sparse !== true,
  );

  const data = {
    documentsScanned: 0,
    totalItems: 0,
    invalidDocuments: 0,
    documentsWithIssue: {},
  };

  const cursor = collection.find(
    {},
    {
      projection: {
        _id: 1,
        user: 1,
        __v: 1,
        items: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      maxTimeMS: QUERY_TIMEOUT_MS,
    },
  );

  for await (const document of cursor) {
    data.documentsScanned += 1;

    if (Array.isArray(document.items)) {
      data.totalItems += document.items.length;
    }

    const issues = inspectDocument(document, target);

    if (issues.size > 0) {
      data.invalidDocuments += 1;
    }

    // Each code counts affected documents, not affected items.
    for (const code of issues) {
      data.documentsWithIssue[code] = (data.documentsWithIssue[code] ?? 0) + 1;
    }
  }

  const duplicateResults = await collection
    .aggregate(
      [
        {
          $match: {
            user: {
              $type: "objectId",
            },
          },
        },
        {
          $group: {
            _id: "$user",
            count: { $sum: 1 },
          },
        },
        {
          $match: {
            count: { $gt: 1 },
          },
        },
        {
          $group: {
            _id: null,

            duplicateUserGroups: {
              $sum: 1,
            },

            extraDocumentsForDuplicateUsers: {
              $sum: {
                $subtract: ["$count", 1],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            duplicateUserGroups: 1,
            extraDocumentsForDuplicateUsers: 1,
          },
        },
      ],
      {
        maxTimeMS: QUERY_TIMEOUT_MS,
      },
    )
    .toArray();

  const duplicates = duplicateResults[0] ?? {
    duplicateUserGroups: 0,
    extraDocumentsForDuplicateUsers: 0,
  };

  const findings = [];

  if (!uniqueUserIndex) {
    findings.push("The required full unique user index is missing or differs.");
  }

  if (target.productIndexRequired && !productIndex) {
    findings.push(
      "The declared Cart items.product lookup index is missing or differs.",
    );
  }

  if (data.invalidDocuments > 0) {
    findings.push("Stored documents contain integrity issues.");
  }

  if (duplicates.duplicateUserGroups > 0) {
    findings.push("Some users have more than one document.");
  }

  return {
    model: target.name,
    collection: target.collection,
    collectionExists: true,

    limits: {
      maxItems: target.maxItems,
      ...(target.maxQuantity ? { maxQuantityPerItem: target.maxQuantity } : {}),
    },

    uniqueUserIndexName: uniqueUserIndex?.name ?? null,

    ...(target.productIndexRequired
      ? { productIndexName: productIndex?.name ?? null }
      : {}),

    indexes: indexes.map(summarizeIndex),

    data: {
      ...data,
      ...duplicates,
    },

    status: findings.length === 0 ? "pass" : "needs-attention",
    findings,
  };
};

/*
|--------------------------------------------------------------------------
| Run Read-Only Audit
|--------------------------------------------------------------------------
*/

const runAudit = async () => {
  let connection;
  let activeCollection = null;

  try {
    connection = mongoose.createConnection(env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
      readPreference: "primary",
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 2,
    });

    await connection.asPromise();

    const results = [];

    for (const target of TARGETS) {
      activeCollection = target.collection;

      results.push(await auditCollection(connection, target));
    }

    const passed = results.every((result) => result.status === "pass");

    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          database: connection.name,
          status: passed ? "pass" : "needs-attention",
          results,
        },
        null,
        2,
      ),
    );

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "audit-failed",
          collection: activeCollection,
          errorName: error.name,
          errorCode: error.code ?? null,
          message:
            "The audit could not complete. Check connectivity, read permissions, and query time limits.",
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};

await runAudit();
