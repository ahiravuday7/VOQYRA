import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import env from "../config/environment.js";
import logger from "../config/logger.js";

import { seedCategories } from "./category.seed.js";

import { seedBrands } from "./brand.seed.js";

import { seedSizeGuides } from "./size-guide.seed.js";

import { seedCollections } from "./collection.seed.js";

import { seedProducts } from "./product.seed.js";

import {
  assertSeedDatabaseTarget,
  assertSeedEnvironment,
} from "./seed-safety.js";

/*
|--------------------------------------------------------------------------
| Run Database Seed
|--------------------------------------------------------------------------
|
| Dependency order matters:
|
| Category
| Brand
| SizeGuide
| Collection
| Product
|
| Product depends on all previous master-data modules.
|
*/

const runSeed = async () => {
  assertSeedEnvironment(env.NODE_ENV);

  logger.info(
    {
      environment: env.NODE_ENV,
    },
    "Database seed started",
  );

  /*
  |--------------------------------------------------------------------------
  | Database
  |--------------------------------------------------------------------------
  */

  await connectDatabase();

  assertSeedDatabaseTarget(mongoose.connection.name);

  logger.info(
    {
      environment: env.NODE_ENV,
      database: mongoose.connection.name,
    },
    "Seed database target verified",
  );

  /*
  |--------------------------------------------------------------------------
  | Categories
  |--------------------------------------------------------------------------
  */

  const categoriesBySlug = await seedCategories();

  /*
  |--------------------------------------------------------------------------
  | Brands
  |--------------------------------------------------------------------------
  */

  const brandsBySlug = await seedBrands();

  /*
  |--------------------------------------------------------------------------
  | Size Guides
  |--------------------------------------------------------------------------
  */

  const sizeGuidesBySlug = await seedSizeGuides(categoriesBySlug);

  /*
  |--------------------------------------------------------------------------
  | Collections
  |--------------------------------------------------------------------------
  */

  const collectionsBySlug = await seedCollections();

  /*
  |--------------------------------------------------------------------------
  | Products
  |--------------------------------------------------------------------------
  */

  const productsBySlug = await seedProducts({
    categoriesBySlug,

    brandsBySlug,

    sizeGuidesBySlug,

    collectionsBySlug,
  });

  /*
  |--------------------------------------------------------------------------
  | Summary
  |--------------------------------------------------------------------------
  */

  logger.info(
    {
      categories: categoriesBySlug.size,

      brands: brandsBySlug.size,

      sizeGuides: sizeGuidesBySlug.size,

      collections: collectionsBySlug.size,

      products: productsBySlug.size,
    },

    "Database seed completed successfully",
  );
};

/*
|--------------------------------------------------------------------------
| Seed Process
|--------------------------------------------------------------------------
|
| Always disconnect MongoDB when the seed finishes or fails.
|
*/

const main = async () => {
  try {
    await runSeed();
  } catch (error) {
    logger.error(
      {
        err: error,
      },

      "Database seed failed",
    );

    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();

      logger.info("MongoDB disconnected after database seed");
    }
  }
};

void main();
