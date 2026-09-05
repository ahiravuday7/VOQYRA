import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import env from "../config/environment.js";
import logger from "../config/logger.js";

import { seedCategories } from "./category.seed.js";

import { seedBrands } from "./brand.seed.js";

import { seedSizeGuides } from "./size-guide.seed.js";

import { seedCollections } from "./collection.seed.js";

import { seedProducts } from "./product.seed.js";

/*
|--------------------------------------------------------------------------
| Seed Environment Safety
|--------------------------------------------------------------------------
|
| Development seed data must never be written to production.
|
*/

const assertSeedEnvironment = () => {
  if (env.NODE_ENV === "production") {
    throw new Error("Database seeding is disabled in production.");
  }
};

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
  assertSeedEnvironment();

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
