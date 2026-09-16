import mongoose from "mongoose";

import env from "../config/environment.js";

const COLLECTION_NAME = "orders";

const EXPECTED_INDEX_NAME = "unique_customer_checkout_idempotency";

const EXPECTED_INDEX_KEYS = {
  customer: 1,
  "checkoutIdempotency.key": 1,
};

const EXPECTED_PARTIAL_FILTER = {
  "checkoutIdempotency.key": {
    $type: "string",
  },
};

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const QUERY_TIMEOUT_MS = 30_000;

const hasExpectedKeys = (index) => {
  return (
    JSON.stringify(Object.entries(index.key ?? {})) ===
    JSON.stringify(Object.entries(EXPECTED_INDEX_KEYS))
  );
};

const hasExpectedDefinition = (index) => {
  return (
    hasExpectedKeys(index) &&
    index.unique === true &&
    index.sparse !== true &&
    (!index.collation || index.collation.locale === "simple") &&
    JSON.stringify(index.partialFilterExpression ?? null) ===
      JSON.stringify(EXPECTED_PARTIAL_FILTER)
  );
};

const summarizeIndex = (index) => {
  return {
    name: index.name,
    key: index.key,
    unique: index.unique === true,
    sparse: index.sparse === true,
    hidden: index.hidden === true,
    partialFilterExpression: index.partialFilterExpression ?? null,
    collation: index.collation ?? null,
    matchesExpectedDefinition: hasExpectedDefinition(index),
  };
};

const runAudit = async () => {
  let connection;

  try {
    // No application models or server processes are imported.
    connection = mongoose.createConnection(env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
      readPreference: "primary",
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 2,
    });

    await connection.asPromise();

    const collectionExists = await connection.db
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .hasNext();

    if (!collectionExists) {
      console.log(
        JSON.stringify(
          {
            mode: "read-only",
            database: connection.name,
            collection: COLLECTION_NAME,
            collectionExists: false,
            status: "needs-attention",
            reason: "Order collection does not exist.",
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
      return;
    }

    const collection = connection.db.collection(COLLECTION_NAME);

    const indexes = await collection.indexes();

    const relevantIndexes = indexes.filter(
      (index) => index.name === EXPECTED_INDEX_NAME || hasExpectedKeys(index),
    );

    const matchingIndex = indexes.find(hasExpectedDefinition);

    const totalOrders = await collection.countDocuments(
      {},
      { maxTimeMS: QUERY_TIMEOUT_MS },
    );

    /*
     * Inspect raw values so Mongoose cannot cast malformed data.
     * Only counters are printed; keys and customer IDs stay private.
     */
    const metadataCounts = {
      ordersWithMetadata: 0,
      invalidMetadataOrders: 0,
      invalidKeys: 0,
      invalidRequestHashes: 0,
      invalidCustomerReferences: 0,
    };

    const cursor = collection.find(
      {
        checkoutIdempotency: {
          $exists: true,
        },
      },
      {
        projection: {
          _id: 0,
          customer: 1,
          checkoutIdempotency: 1,
        },

        maxTimeMS: QUERY_TIMEOUT_MS,
      },
    );

    for await (const order of cursor) {
      metadataCounts.ordersWithMetadata += 1;

      const metadata = order.checkoutIdempotency;

      const metadataIsObject =
        metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata);

      const validKey =
        metadataIsObject &&
        typeof metadata.key === "string" &&
        KEY_PATTERN.test(metadata.key);

      const validHash =
        metadataIsObject &&
        typeof metadata.requestHash === "string" &&
        HASH_PATTERN.test(metadata.requestHash);

      const validCustomer = order.customer?._bsontype === "ObjectId";

      if (!validKey) {
        metadataCounts.invalidKeys += 1;
      }

      if (!validHash) {
        metadataCounts.invalidRequestHashes += 1;
      }

      if (!validCustomer) {
        metadataCounts.invalidCustomerReferences += 1;
      }

      if (!validKey || !validHash || !validCustomer) {
        metadataCounts.invalidMetadataOrders += 1;
      }
    }

    /*
     * Check duplicates using the same customer + key combination
     * protected by the partial unique index.
     */
    const duplicateResults = await collection
      .aggregate(
        [
          {
            $match: {
              "checkoutIdempotency.key": {
                $type: "string",
              },
            },
          },
          {
            $group: {
              _id: {
                customer: "$customer",
                key: "$checkoutIdempotency.key",
              },

              count: {
                $sum: 1,
              },
            },
          },
          {
            $match: {
              count: {
                $gt: 1,
              },
            },
          },
          {
            $group: {
              _id: null,

              duplicateKeyGroups: {
                $sum: 1,
              },

              extraOrdersWithDuplicateKeys: {
                $sum: {
                  $subtract: ["$count", 1],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              duplicateKeyGroups: 1,
              extraOrdersWithDuplicateKeys: 1,
            },
          },
        ],
        {
          maxTimeMS: QUERY_TIMEOUT_MS,
        },
      )
      .toArray();

    const duplicates = duplicateResults[0] ?? {
      duplicateKeyGroups: 0,
      extraOrdersWithDuplicateKeys: 0,
    };

    const findings = [];

    if (!matchingIndex) {
      findings.push(
        "The required unique index is missing or its definition differs.",
      );
    }

    if (metadataCounts.invalidMetadataOrders > 0) {
      findings.push(
        "Some Orders contain malformed checkout idempotency metadata.",
      );
    }

    if (duplicates.duplicateKeyGroups > 0) {
      findings.push("Duplicate customer and checkout-key combinations exist.");
    }

    const report = {
      mode: "read-only",
      database: connection.name,
      collection: COLLECTION_NAME,
      collectionExists: true,

      expectedIndex: {
        name: EXPECTED_INDEX_NAME,
        key: EXPECTED_INDEX_KEYS,
        unique: true,
        partialFilterExpression: EXPECTED_PARTIAL_FILTER,
      },

      matchingIndexName: matchingIndex?.name ?? null,

      relevantIndexes: relevantIndexes.map(summarizeIndex),

      data: {
        totalOrders,
        ordersWithoutMetadata: totalOrders - metadataCounts.ordersWithMetadata,
        ...metadataCounts,
        ...duplicates,
      },

      status: findings.length === 0 ? "pass" : "needs-attention",
      findings,
    };

    console.log(JSON.stringify(report, null, 2));

    if (findings.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "audit-failed",
          errorName: error.name,
          errorCode: error.code ?? null,
          message:
            "The audit could not complete. Check database connectivity, read permissions, and query time limits.",
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
