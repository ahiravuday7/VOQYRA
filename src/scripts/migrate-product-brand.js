import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import logger from "../config/logger.js";

import Product from "../modules/products/product.model.js";
import Brand from "../modules/brands/brand.model.js";

import { BRAND_STATUSES } from "../shared/constants/brand.constants.js";

import { PRODUCT_STATUSES } from "../shared/constants/product.constants.js";

/*
|--------------------------------------------------------------------------
| Migration Mode
|--------------------------------------------------------------------------
|
| Default:
|
| npm run migrate:product-brand
|
| = DRY RUN
|
| Actual mutation:
|
| npm run migrate:product-brand:apply
|
| = APPLY
|--------------------------------------------------------------------------
*/

const shouldApply = process.argv.includes("--apply");

/*
|--------------------------------------------------------------------------
| Normalize Brand Name
|--------------------------------------------------------------------------
*/

const normalizeBrandName = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");

  return normalized || null;
};

/*
|--------------------------------------------------------------------------
| Build Brand Lookup
|--------------------------------------------------------------------------
*/

const buildBrandLookup = (brands) => {
  const lookup = new Map();

  for (const brand of brands) {
    const normalizedName = normalizeBrandName(brand.name);

    if (!normalizedName) {
      continue;
    }

    const existing = lookup.get(normalizedName) ?? [];

    existing.push(brand);

    lookup.set(normalizedName, existing);
  }

  return lookup;
};

/*
|--------------------------------------------------------------------------
| Report Helpers
|--------------------------------------------------------------------------
*/

const mapBrand = (brand) => {
  return {
    id: String(brand._id),

    name: brand.name,

    slug: brand.slug,

    status: brand.status,

    deletedAt: brand.deletedAt ?? null,
  };
};

const mapProduct = (product) => {
  return {
    id: String(product._id),

    name: product.name ?? null,

    slug: product.slug ?? null,

    status: product.status ?? null,

    brand: product.brand ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Build Migration Plan
|--------------------------------------------------------------------------
*/

const buildMigrationPlan = async () => {
  const brands = await Brand.find({})
    .select(["_id", "name", "slug", "status", "deletedAt"].join(" "))
    .lean();

  /*
   * Read raw Product values.
   *
   * This is important because Product.brand
   * is currently still String in Mongoose.
   */
  const products = await Product.collection
    .find({})
    .project({
      _id: 1,
      name: 1,
      slug: 1,
      status: 1,
      brand: 1,
    })
    .toArray();

  const brandLookup = buildBrandLookup(brands);

  const operations = [];

  const alreadyMigrated = [];

  const errors = [];

  for (const product of products) {
    const productReport = mapProduct(product);

    /*
      |--------------------------------------------------------------------------
      | Already ObjectId
      |--------------------------------------------------------------------------
      */

    if (product.brand instanceof mongoose.Types.ObjectId) {
      const matchingBrand = brands.find(
        (brand) => String(brand._id) === String(product.brand),
      );

      if (!matchingBrand) {
        errors.push({
          type: "BROKEN_BRAND_REFERENCE",

          product: productReport,

          brandId: String(product.brand),
        });

        continue;
      }

      alreadyMigrated.push({
        product: productReport,

        brand: mapBrand(matchingBrand),
      });

      continue;
    }

    /*
      |--------------------------------------------------------------------------
      | Existing String
      |--------------------------------------------------------------------------
      */

    const normalizedName = normalizeBrandName(product.brand);

    if (!normalizedName) {
      errors.push({
        type: "INVALID_PRODUCT_BRAND",

        product: productReport,
      });

      continue;
    }

    const candidates = brandLookup.get(normalizedName) ?? [];

    if (candidates.length === 0) {
      errors.push({
        type: "BRAND_NOT_FOUND",

        product: productReport,

        normalizedBrand: normalizedName,
      });

      continue;
    }

    if (candidates.length > 1) {
      errors.push({
        type: "AMBIGUOUS_BRAND",

        product: productReport,

        normalizedBrand: normalizedName,

        candidates: candidates.map(mapBrand),
      });

      continue;
    }

    const brand = candidates[0];

    /*
      |--------------------------------------------------------------------------
      | Deleted Brand
      |--------------------------------------------------------------------------
      */

    if (brand.deletedAt) {
      errors.push({
        type: "BRAND_DELETED",

        product: productReport,

        brand: mapBrand(brand),
      });

      continue;
    }

    /*
      |--------------------------------------------------------------------------
      | Active Product Requires Active Brand
      |--------------------------------------------------------------------------
      */

    if (
      product.status === PRODUCT_STATUSES.ACTIVE &&
      brand.status !== BRAND_STATUSES.ACTIVE
    ) {
      errors.push({
        type: "ACTIVE_PRODUCT_BRAND_INACTIVE",

        product: productReport,

        brand: mapBrand(brand),
      });

      continue;
    }

    /*
      |--------------------------------------------------------------------------
      | Safe Migration
      |--------------------------------------------------------------------------
      */

    operations.push({
      productId: product._id,

      product: productReport,

      oldBrand: product.brand,

      brand: mapBrand(brand),

      brandId: brand._id,
    });
  }

  return {
    products,
    brands,
    operations,
    alreadyMigrated,
    errors,
  };
};

/*
|--------------------------------------------------------------------------
| Apply Migration
|--------------------------------------------------------------------------
*/

const applyMigration = async (operations) => {
  if (operations.length === 0) {
    return {
      matchedCount: 0,
      modifiedCount: 0,
    };
  }

  let result = null;

  await mongoose.connection.transaction(async (session) => {
    const bulkOperations = operations.map((operation) => ({
      updateOne: {
        /*
         * Include the old string value
         * so the migration cannot silently
         * overwrite a Product changed by
         * another process.
         */
        filter: {
          _id: operation.productId,

          brand: operation.oldBrand,
        },

        update: {
          $set: {
            brand: operation.brandId,
          },
        },
      },
    }));

    result = await Product.collection.bulkWrite(bulkOperations, {
      session,
      ordered: true,
    });

    /*
     * Every planned Product must have
     * matched its expected old value.
     */
    if (result.matchedCount !== operations.length) {
      throw new Error(
        [
          "Product Brand migration changed while it was running.",
          `Expected ${operations.length} matches`,
          `but found ${result.matchedCount}.`,
        ].join(" "),
      );
    }
  });

  return result;
};

/*
|--------------------------------------------------------------------------
| Migration Runner
|--------------------------------------------------------------------------
*/

const runMigration = async () => {
  try {
    await connectDatabase();

    const { products, brands, operations, alreadyMigrated, errors } =
      await buildMigrationPlan();

    const summary = {
      mode: shouldApply ? "apply" : "dry-run",

      totalProducts: products.length,

      totalBrands: brands.length,

      pendingMigrations: operations.length,

      alreadyMigrated: alreadyMigrated.length,

      errors: errors.length,

      safeToApply: errors.length === 0,
    };

    logger.info(
      {
        summary,
      },
      "Product Brand migration plan",
    );

    /*
      |--------------------------------------------------------------------------
      | Show Planned Changes
      |--------------------------------------------------------------------------
      */

    if (operations.length) {
      logger.info(
        {
          migrations: operations.map((operation) => ({
            product: operation.product,

            from: operation.oldBrand,

            to: {
              brandId: String(operation.brandId),

              brandName: operation.brand.name,
            },
          })),
        },
        "Product Brand migrations ready",
      );
    }

    /*
      |--------------------------------------------------------------------------
      | Unsafe Conditions
      |--------------------------------------------------------------------------
      */

    if (errors.length) {
      logger.error(
        {
          errors,
        },
        "Product Brand migration cannot continue",
      );

      process.exitCode = 1;

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Dry Run
      |--------------------------------------------------------------------------
      */

    if (!shouldApply) {
      logger.info(
        {
          pendingMigrations: operations.length,
        },
        "DRY RUN complete - no Product documents were changed",
      );

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Apply
      |--------------------------------------------------------------------------
      */

    const result = await applyMigration(operations);

    logger.info(
      {
        matchedCount: result.matchedCount,

        modifiedCount: result.modifiedCount,
      },
      "Product Brand migration applied successfully",
    );
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Product Brand migration failed",
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

runMigration();
