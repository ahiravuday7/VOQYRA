import Category from "../modules/categories/category.model.js";

import { CATEGORY_STATUSES } from "../shared/constants/category.constants.js";

import { findOrCreateSeedDocument } from "./seed-document.helper.js";

/*
|--------------------------------------------------------------------------
| Category Seed Data
|--------------------------------------------------------------------------
|
| Keep parent categories before their children.
|
| parentSlug is used only by the seed script.
| It is NOT stored in MongoDB.
|
*/

const CATEGORY_SEED_DATA = Object.freeze([
  {
    name: "Men",

    slug: "men",

    description: "Men's clothing and fashion.",

    parentSlug: null,

    isFeatured: true,

    sortOrder: 10,
  },

  {
    name: "Women",

    slug: "women",

    description: "Women's clothing and fashion.",

    parentSlug: null,

    isFeatured: true,

    sortOrder: 20,
  },

  {
    name: "Shirts",

    slug: "men-shirts",

    description: "Shirts for men.",

    parentSlug: "men",

    isFeatured: false,

    sortOrder: 10,
  },

  {
    name: "T-Shirts",

    slug: "men-t-shirts",

    description: "T-shirts for men.",

    parentSlug: "men",

    isFeatured: false,

    sortOrder: 20,
  },

  {
    name: "Sarees",

    slug: "women-sarees",

    description: "Sarees for women.",

    parentSlug: "women",

    isFeatured: true,

    sortOrder: 10,
  },

  {
    name: "Kurtis",

    slug: "women-kurtis",

    description: "Kurtis for women.",

    parentSlug: "women",

    isFeatured: false,

    sortOrder: 20,
  },
]);

export const seedCategories = async () => {
  const categoriesBySlug = new Map();

  for (const { parentSlug, ...data } of CATEGORY_SEED_DATA) {
    const category = await findOrCreateSeedDocument(Category, data.slug, () => {
      const parent = parentSlug ? categoriesBySlug.get(parentSlug) : null;

      if (parentSlug && !parent) {
        throw new Error(
          `Missing seed parent "${parentSlug}" for "${data.slug}".`,
        );
      }

      const ancestors = parent ? [...(parent.ancestors ?? []), parent._id] : [];

      return {
        ...data,
        parent: parent?._id ?? null,
        ancestors,
        level: ancestors.length,
        status: CATEGORY_STATUSES.ACTIVE,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
        deletedBy: null,
      };
    });

    categoriesBySlug.set(category.slug, category);
  }

  return categoriesBySlug;
};
