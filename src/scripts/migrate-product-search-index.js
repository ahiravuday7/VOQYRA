import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import logger from "../config/logger.js";

/*
|--------------------------------------------------------------------------
| Product Text Search Index
|--------------------------------------------------------------------------
*/

const PRODUCT_COLLECTION_NAME = "products";

const PRODUCT_SEARCH_INDEX_NAME = "product_search_text_index";

const expectedWeights = {
  name: 10,

  tags: 5,

  shortDescription: 3,

  description: 1,
};

/*
|--------------------------------------------------------------------------
| Check Existing Index
|--------------------------------------------------------------------------
*/

const isCurrentSearchIndex = (index) => {
  if (!index) {
    return false;
  }

  const weights = index.weights ?? {};

  const expectedKeys = Object.keys(expectedWeights).sort();

  const actualKeys = Object.keys(weights).sort();

  if (expectedKeys.length !== actualKeys.length) {
    return false;
  }

  for (
    let indexPosition = 0;
    indexPosition < expectedKeys.length;
    indexPosition += 1
  ) {
    if (expectedKeys[indexPosition] !== actualKeys[indexPosition]) {
      return false;
    }
  }

  return expectedKeys.every((field) => {
    return weights[field] === expectedWeights[field];
  });
};

/*
|--------------------------------------------------------------------------
| Migration
|--------------------------------------------------------------------------
*/

const migrateProductSearchIndex = async () => {
  try {
    await connectDatabase();

    const collection = mongoose.connection.db.collection(
      PRODUCT_COLLECTION_NAME,
    );

    const indexes = await collection.indexes();

    const existingIndex = indexes.find(
      (index) => index.name === PRODUCT_SEARCH_INDEX_NAME,
    );

    /*
      |--------------------------------------------------------------------------
      | Already Current
      |--------------------------------------------------------------------------
      */

    if (isCurrentSearchIndex(existingIndex)) {
      logger.info(
        {
          index: PRODUCT_SEARCH_INDEX_NAME,
        },
        "Product search index is already current",
      );

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Drop Old Index
      |--------------------------------------------------------------------------
      */

    if (existingIndex) {
      logger.info(
        {
          index: PRODUCT_SEARCH_INDEX_NAME,

          currentWeights: existingIndex.weights ?? null,
        },
        "Dropping old Product search index",
      );

      await collection.dropIndex(PRODUCT_SEARCH_INDEX_NAME);
    }

    /*
      |--------------------------------------------------------------------------
      | Create New Text Index
      |--------------------------------------------------------------------------
      */

    await collection.createIndex(
      {
        name: "text",

        shortDescription: "text",

        description: "text",

        tags: "text",
      },
      {
        name: PRODUCT_SEARCH_INDEX_NAME,

        weights: expectedWeights,
      },
    );

    logger.info(
      {
        index: PRODUCT_SEARCH_INDEX_NAME,

        weights: expectedWeights,
      },
      "Product search index migrated successfully",
    );
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Product search index migration failed",
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

migrateProductSearchIndex();
