import Category from "../modules/categories/category.model.js";

import { CATEGORY_STATUSES } from "../shared/constants/category.constants.js";

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

/*
|--------------------------------------------------------------------------
| Seed Categories
|--------------------------------------------------------------------------
|
| Idempotency:
|
| First run:
| category does not exist
| → create it
|
| Second run:
| category already exists
| → update/reuse it
|
| No duplicate categories are created.
|
| Slug is our stable seed identity.
|
*/

export const seedCategories = async () => {
  const categoriesBySlug = new Map();

  for (const seedData of CATEGORY_SEED_DATA) {
    const {
      parentSlug,

      ...categoryData
    } = seedData;

    /*
     * Parent categories appear before child categories
     * inside CATEGORY_SEED_DATA.
     */
    const parentCategory = parentSlug ? categoriesBySlug.get(parentSlug) : null;

    if (parentSlug && !parentCategory) {
      throw new Error(
        `Category seed parent "${parentSlug}" must be seeded before "${categoryData.slug}".`,
      );
    }

    /*
     * Root:
     *
     * parent = null
     * ancestors = []
     * level = 0
     *
     * Child:
     *
     * parent = parent._id
     * ancestors = [...parent.ancestors, parent._id]
     * level = ancestors.length
     */
    const ancestors = parentCategory
      ? [...(parentCategory.ancestors ?? []), parentCategory._id]
      : [];

    const category = await Category.findOneAndUpdate(
      {
        slug: categoryData.slug,
      },

      {
        $set: {
          ...categoryData,

          parent: parentCategory?._id ?? null,

          ancestors,

          level: ancestors.length,

          status: CATEGORY_STATUSES.ACTIVE,

          /*
           * Running the development seed again
           * restores one of our seed categories
           * if it was previously soft-deleted.
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

    categoriesBySlug.set(
      category.slug,

      category,
    );
  }

  /*
   * Later Product / SizeGuide seeds can do:
   *
   * categoriesBySlug.get("women-sarees")._id
   *
   * instead of hardcoding ObjectIds.
   */
  return categoriesBySlug;
};
