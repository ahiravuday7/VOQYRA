import mongoose from "mongoose";

import env from "../config/environment.js";

const TARGETS = [
  {
    collection: "carts",

    indexes: [
      {
        key: { user: 1 },
        options: {
          name: "user_1",
          unique: true,
        },
      },
      {
        key: { "items.product": 1 },
        options: {
          name: "items.product_1",
        },
      },
    ],
  },
  {
    collection: "wishlists",

    indexes: [
      {
        key: { user: 1 },
        options: {
          name: "user_1",
          unique: true,
        },
      },
    ],
  },
  {
    collection: "recentlyvieweds",

    indexes: [
      {
        key: { user: 1 },
        options: {
          name: "user_1",
          unique: true,
        },
      },
    ],
  },
];

const ensureIndexes = async () => {
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

      const exists = await connection.db
        .listCollections({ name: target.collection }, { nameOnly: true })
        .hasNext();

      let collectionCreated = false;

      if (!exists) {
        try {
          await connection.db.createCollection(target.collection);
          collectionCreated = true;
        } catch (error) {
          // Another process may have created it after our check.
          if (error.code !== 48) {
            throw error;
          }
        }
      }

      const collection = connection.db.collection(target.collection);

      for (const index of target.indexes) {
        await collection.createIndex(index.key, {
          ...index.options,
          maxTimeMS: 60_000,
        });
      }

      const actualIndexes = await collection.indexes();

      const expectedNames = target.indexes.map((index) => index.options.name);

      const installedIndexes = actualIndexes.filter((index) =>
        expectedNames.includes(index.name),
      );

      if (installedIndexes.length !== expectedNames.length) {
        throw new Error("Index verification failed");
      }

      results.push({
        collection: target.collection,
        collectionCreated,
        status: "indexes-present",

        indexes: installedIndexes.map((index) => ({
          name: index.name,
          key: index.key,
          unique: index.unique === true,
        })),
      });
    }

    console.log(
      JSON.stringify(
        {
          status: "setup-complete",
          database: connection.name,
          results,
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
          collection: activeCollection,
          errorName: error.name,
          errorCode: error.code ?? null,

          message:
            error.code === 11000
              ? "Duplicate user values prevented unique index creation."
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
