import mongoose from "mongoose";

import env from "../config/environment.js";

const COLLECTION_NAME = "orders";
const INDEX_NAME = "unique_customer_checkout_idempotency";

const ensureIndex = async () => {
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

    const collectionExists = await connection.db
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .hasNext();

    if (!collectionExists) {
      console.error("Order collection does not exist.");
      process.exitCode = 1;
      return;
    }

    const collection = connection.db.collection(COLLECTION_NAME);

    /*
     * Creates only this index.
     * Repeating this command with the same definition is safe.
     * Conflicting existing definitions cause an error.
     */
    await collection.createIndex(
      {
        customer: 1,
        "checkoutIdempotency.key": 1,
      },
      {
        name: INDEX_NAME,
        unique: true,

        partialFilterExpression: {
          "checkoutIdempotency.key": {
            $type: "string",
          },
        },

        maxTimeMS: 60_000,
      },
    );

    const indexes = await collection.indexes();

    const index = indexes.find((entry) => entry.name === INDEX_NAME);

    if (!index) {
      throw new Error("Index verification failed");
    }

    console.log(
      JSON.stringify(
        {
          status: "index-present",
          database: connection.name,
          collection: COLLECTION_NAME,
          index: {
            name: index.name,
            key: index.key,
            unique: index.unique === true,
            partialFilterExpression: index.partialFilterExpression,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "index-setup-failed",
          errorName: error.name,
          errorCode: error.code ?? null,

          message:
            error.code === 11000
              ? "Duplicate customer and checkout-key combinations prevented index creation."
              : error.code === 85 || error.code === 86
                ? "An existing index conflicts with the requested definition."
                : "Index setup could not complete. Check connectivity, permissions, and database state.",
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.close();
    }
  }
};

await ensureIndex();
