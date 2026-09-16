import mongoose from "mongoose";

import env from "../config/environment.js";

const COLLECTION_NAME = "addresses";

const INDEXES = [
  {
    key: { user: 1 },
    options: {
      name: "user_1",
    },
  },
  {
    key: { deletedAt: 1 },
    options: {
      name: "deletedAt_1",
    },
  },
  {
    key: {
      user: 1,
      deletedAt: 1,
      createdAt: -1,
    },
    options: {
      name: "user_addresses_index",
    },
  },
  {
    key: {
      user: 1,
      isDefaultShipping: 1,
    },
    options: {
      name: "unique_default_shipping_address",
      unique: true,

      partialFilterExpression: {
        isDefaultShipping: true,
        deletedAt: null,
      },
    },
  },
  {
    key: {
      user: 1,
      isDefaultBilling: 1,
    },
    options: {
      name: "unique_default_billing_address",
      unique: true,

      partialFilterExpression: {
        isDefaultBilling: true,
        deletedAt: null,
      },
    },
  },
];

const ensureIndexes = async () => {
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

    const exists = await connection.db
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .hasNext();

    let collectionCreated = false;

    if (!exists) {
      try {
        await connection.db.createCollection(COLLECTION_NAME);
        collectionCreated = true;
      } catch (error) {
        // Another process may have created it after our check.
        if (error.code !== 48) {
          throw error;
        }
      }
    }

    const collection = connection.db.collection(COLLECTION_NAME);

    for (const index of INDEXES) {
      await collection.createIndex(index.key, {
        ...index.options,
        maxTimeMS: 60_000,
      });
    }

    const actualIndexes = await collection.indexes();

    const expectedNames = INDEXES.map((index) => index.options.name);

    const installedIndexes = actualIndexes.filter((index) =>
      expectedNames.includes(index.name),
    );

    if (installedIndexes.length !== expectedNames.length) {
      throw new Error("Index verification failed");
    }

    console.log(
      JSON.stringify(
        {
          status: "setup-complete",
          database: connection.name,
          collection: COLLECTION_NAME,
          collectionCreated,

          indexes: installedIndexes.map((index) => ({
            name: index.name,
            key: index.key,
            unique: index.unique === true,
            partialFilterExpression: index.partialFilterExpression ?? null,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "setup-failed",
          collection: COLLECTION_NAME,
          errorName: error.name,
          errorCode: error.code ?? null,

          message:
            error.code === 11000
              ? "Duplicate default addresses prevented unique index creation."
              : error.code === 85 || error.code === 86
                ? "An existing index conflicts with the requested definition."
                : "Setup could not complete. Check connectivity, permissions, and database state.",
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

await ensureIndexes();
