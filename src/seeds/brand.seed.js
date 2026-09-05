import Brand from "../modules/brands/brand.model.js";

import { BRAND_STATUSES } from "../shared/constants/brand.constants.js";

/*
|--------------------------------------------------------------------------
| Brand Seed Data
|--------------------------------------------------------------------------
|
| Slug is the stable identity for seeded Brands.
|
| Important:
| We intentionally do not seed logo here.
|
| Later, when Brand image upload exists, running the seed again
| should not erase a previously uploaded logo.
|
*/

const BRAND_SEED_DATA = Object.freeze([
  {
    name: "Aayu & Aura",

    slug: "aayu-and-aura",

    description:
      "Contemporary clothing with a focus on elegant everyday and occasion wear.",

    isFeatured: true,

    sortOrder: 10,
  },

  {
    name: "Urban Thread",

    slug: "urban-thread",

    description: "Modern casual clothing inspired by everyday urban style.",

    isFeatured: true,

    sortOrder: 20,
  },

  {
    name: "Classic Wear",

    slug: "classic-wear",

    description: "Timeless clothing styles designed for everyday comfort.",

    isFeatured: false,

    sortOrder: 30,
  },
]);

/*
|--------------------------------------------------------------------------
| Seed Brands
|--------------------------------------------------------------------------
|
| Idempotent behavior:
|
| First run:
| Brand does not exist
| → create it
|
| Later run:
| Brand already exists
| → update/reuse it
|
| Deleted seeded Brand:
| → restore it
|
*/

export const seedBrands = async () => {
  const brandsBySlug = new Map();

  for (const brandData of BRAND_SEED_DATA) {
    const brand = await Brand.findOneAndUpdate(
      {
        slug: brandData.slug,
      },

      {
        $set: {
          ...brandData,

          status: BRAND_STATUSES.ACTIVE,

          /*
           * Restore seeded Brand if someone
           * soft-deleted it in development.
           */
          deletedAt: null,

          deletedBy: null,

          updatedBy: null,
        },

        $setOnInsert: {
          createdBy: null,
        },
      },

      {
        returnDocument: "after",

        upsert: true,

        runValidators: true,

        setDefaultsOnInsert: true,
      },
    );

    brandsBySlug.set(
      brand.slug,

      brand,
    );
  }

  /*
   * Product seed will later use:
   *
   * brandsBySlug.get("aayu-and-aura")._id
   *
   * Never:
   *
   * brand: "Aayu & Aura"
   */
  return brandsBySlug;
};
