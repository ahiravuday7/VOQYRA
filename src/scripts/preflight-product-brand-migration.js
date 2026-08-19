import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import logger from "../config/logger.js";

import Product from "../modules/products/product.model.js";
import Brand from "../modules/brands/brand.model.js";

/*
|--------------------------------------------------------------------------
| Normalize Brand Name
|--------------------------------------------------------------------------
|
| Existing Product brands are currently stored as strings.
|
| We intentionally use conservative matching:
|
| "Aayu & Aura"
| "  AAYU & AURA  "
|
| can match.
|
| But:
|
| "Aayu"
| "Aayu and Aura"
|
| will NOT be guessed as "Aayu & Aura".
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
|
| Brand names are not assumed to be globally unique.
|
| Therefore:
|
| normalized name
|      ↓
| Brand[]
|
| If more than one Brand matches the same normalized name,
| migration is considered ambiguous.
|--------------------------------------------------------------------------
*/

const buildBrandLookup = (brands) => {
  const lookup = new Map();

  for (const brand of brands) {
    const normalizedName = normalizeBrandName(brand.name);

    if (!normalizedName) {
      continue;
    }

    const current = lookup.get(normalizedName) ?? [];

    current.push(brand);

    lookup.set(normalizedName, current);
  }

  return lookup;
};

/*
|--------------------------------------------------------------------------
| Simplify Brand
|--------------------------------------------------------------------------
*/

const mapBrandForReport = (brand) => {
  return {
    id: String(brand._id),

    name: brand.name,

    slug: brand.slug,

    status: brand.status,

    deletedAt: brand.deletedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Simplify Product
|--------------------------------------------------------------------------
*/

const mapProductForReport = (product) => {
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
| Product Brand Migration Preflight
|--------------------------------------------------------------------------
*/

const runPreflight = async () => {
  try {
    /*
    |--------------------------------------------------------------------------
    | Connect
    |--------------------------------------------------------------------------
    */

    await connectDatabase();

    /*
    |--------------------------------------------------------------------------
    | Load Brand Master Data
    |--------------------------------------------------------------------------
    */

    const brands = await Brand.find({})
      .select(["_id", "name", "slug", "status", "deletedAt"].join(" "))
      .lean();

    /*
    |--------------------------------------------------------------------------
    | Read Raw Product Documents
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    |
    | Use the underlying MongoDB collection rather than Product.find().
    |
    | Product.brand is currently defined as String in Mongoose.
    |
    | Reading raw documents prevents the current schema from hiding or
    | coercing unexpected database values during migration analysis.
    |--------------------------------------------------------------------------
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

    /*
    |--------------------------------------------------------------------------
    | Report Buckets
    |--------------------------------------------------------------------------
    */

    const exactMatches = [];

    const inactiveBrandMatches = [];

    const deletedBrandMatches = [];

    const ambiguousMatches = [];

    const unmappedProducts = [];

    const invalidBrandValues = [];

    const alreadyReferenced = [];

    const brokenReferences = [];

    /*
    |--------------------------------------------------------------------------
    | Analyze Every Product
    |--------------------------------------------------------------------------
    */

    for (const product of products) {
      const productReport = mapProductForReport(product);

      /*
      |--------------------------------------------------------------------------
      | Already ObjectId
      |--------------------------------------------------------------------------
      |
      | This should normally be empty before migration.
      |
      | However, supporting it makes the script safe to rerun during a
      | partially completed migration.
      |--------------------------------------------------------------------------
      */

      if (product.brand instanceof mongoose.Types.ObjectId) {
        const referencedBrand = brands.find((brand) => {
          return String(brand._id) === String(product.brand);
        });

        if (!referencedBrand) {
          brokenReferences.push({
            product: productReport,

            brandId: String(product.brand),
          });

          continue;
        }

        alreadyReferenced.push({
          product: productReport,

          brand: mapBrandForReport(referencedBrand),
        });

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Invalid Current Value
      |--------------------------------------------------------------------------
      */

      const normalizedBrand = normalizeBrandName(product.brand);

      if (!normalizedBrand) {
        invalidBrandValues.push({
          product: productReport,

          reason: "Product brand is missing, empty, or not a string/ObjectId",
        });

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Find Exact Normalized Name Match
      |--------------------------------------------------------------------------
      */

      const candidates = brandLookup.get(normalizedBrand) ?? [];

      /*
      |--------------------------------------------------------------------------
      | No Match
      |--------------------------------------------------------------------------
      */

      if (candidates.length === 0) {
        unmappedProducts.push({
          product: productReport,

          normalizedBrand,
        });

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Ambiguous Match
      |--------------------------------------------------------------------------
      */

      if (candidates.length > 1) {
        ambiguousMatches.push({
          product: productReport,

          normalizedBrand,

          candidates: candidates.map(mapBrandForReport),
        });

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Single Exact Match
      |--------------------------------------------------------------------------
      */

      const targetBrand = candidates[0];

      const match = {
        product: productReport,

        targetBrand: mapBrandForReport(targetBrand),
      };

      /*
       * Deleted Brand:
       *
       * Do not automatically migrate to it.
       */
      if (targetBrand.deletedAt) {
        deletedBrandMatches.push(match);

        continue;
      }

      /*
       * Inactive Brand:
       *
       * The ID mapping itself is deterministic,
       * but we flag it because an active Product
       * will later require an active Brand.
       */
      if (targetBrand.status === "inactive") {
        inactiveBrandMatches.push(match);

        continue;
      }

      exactMatches.push(match);
    }

    /*
    |--------------------------------------------------------------------------
    | Summary
    |--------------------------------------------------------------------------
    */

    const unsafeCount =
      ambiguousMatches.length +
      unmappedProducts.length +
      invalidBrandValues.length +
      deletedBrandMatches.length +
      brokenReferences.length;

    const warningCount = inactiveBrandMatches.length;

    const summary = {
      totalProducts: products.length,

      totalBrands: brands.length,

      exactActiveMatches: exactMatches.length,

      exactInactiveMatches: inactiveBrandMatches.length,

      deletedBrandMatches: deletedBrandMatches.length,

      ambiguousMatches: ambiguousMatches.length,

      unmappedProducts: unmappedProducts.length,

      invalidBrandValues: invalidBrandValues.length,

      alreadyReferenced: alreadyReferenced.length,

      brokenReferences: brokenReferences.length,

      unsafeCount,

      warningCount,

      readyForAutomaticMigration: unsafeCount === 0,
    };

    /*
    |--------------------------------------------------------------------------
    | Log Summary
    |--------------------------------------------------------------------------
    */

    logger.info(
      {
        summary,
      },
      "Product Brand migration preflight summary",
    );

    /*
    |--------------------------------------------------------------------------
    | Log Safe Matches
    |--------------------------------------------------------------------------
    */

    if (exactMatches.length) {
      logger.info(
        {
          matches: exactMatches,
        },
        "Products with exact active Brand matches",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Log Warnings
    |--------------------------------------------------------------------------
    */

    if (inactiveBrandMatches.length) {
      logger.warn(
        {
          matches: inactiveBrandMatches,
        },
        "Products mapped to inactive Brands require review",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Log Unsafe Conditions
    |--------------------------------------------------------------------------
    */

    if (deletedBrandMatches.length) {
      logger.error(
        {
          matches: deletedBrandMatches,
        },
        "Products match soft-deleted Brands",
      );
    }

    if (ambiguousMatches.length) {
      logger.error(
        {
          matches: ambiguousMatches,
        },
        "Products have ambiguous Brand matches",
      );
    }

    if (unmappedProducts.length) {
      logger.error(
        {
          products: unmappedProducts,
        },
        "Products contain Brand names that do not match Brand master data",
      );
    }

    if (invalidBrandValues.length) {
      logger.error(
        {
          products: invalidBrandValues,
        },
        "Products contain invalid Brand values",
      );
    }

    if (brokenReferences.length) {
      logger.error(
        {
          products: brokenReferences,
        },
        "Products contain Brand ObjectIds that reference missing Brands",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Final Result
    |--------------------------------------------------------------------------
    */

    if (unsafeCount > 0) {
      logger.error(
        {
          unsafeCount,
        },
        "Product Brand migration preflight FAILED",
      );

      process.exitCode = 1;

      return;
    }

    if (warningCount > 0) {
      logger.warn(
        {
          warningCount,
        },
        "Product Brand migration preflight passed with inactive Brand warnings",
      );

      return;
    }

    logger.info("Product Brand migration preflight PASSED");
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Product Brand migration preflight crashed",
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

runPreflight();
