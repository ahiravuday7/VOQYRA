import Brand from "../modules/brands/brand.model.js";

import { BRAND_STATUSES } from "../shared/constants/brand.constants.js";

import { findOrCreateSeedDocument } from "./seed-document.helper.js";

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

export const seedBrands = async () => {
  const brandsBySlug = new Map();

  for (const data of BRAND_SEED_DATA) {
    const brand = await findOrCreateSeedDocument(Brand, data.slug, () => ({
      ...data,
      status: BRAND_STATUSES.ACTIVE,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
      deletedBy: null,
    }));

    brandsBySlug.set(brand.slug, brand);
  }

  return brandsBySlug;
};
