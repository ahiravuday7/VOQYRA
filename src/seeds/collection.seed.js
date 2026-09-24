import Collection from "../modules/collections/collection.model.js";

import { COLLECTION_STATUSES } from "../shared/constants/collection.constants.js";

import { findOrCreateSeedDocument } from "./seed-document.helper.js";
/*
|--------------------------------------------------------------------------
| Collection Seed Data
|--------------------------------------------------------------------------
|
| Collection does NOT contain Product IDs.
|
| The relationship source of truth remains:
|
| Product.collections[]
|
| Product seeds will later resolve Collection ObjectIds
| from the Map returned by seedCollections().
|
*/

const COLLECTION_SEED_DATA = Object.freeze([
  {
    name: "New Arrivals",

    slug: "new-arrivals",

    description:
      "Recently added clothing and the latest products in the catalog.",

    isFeatured: true,

    sortOrder: 10,
  },

  {
    name: "Best Sellers",

    slug: "best-sellers",

    description: "Popular clothing selected for the best sellers collection.",

    isFeatured: true,

    sortOrder: 20,
  },

  {
    name: "Festive Collection",

    slug: "festive-collection",

    description: "Clothing selected for festive and special occasions.",

    isFeatured: true,

    sortOrder: 30,
  },

  {
    name: "Summer Collection",

    slug: "summer-collection",

    description: "Comfortable and lightweight clothing for the summer season.",

    isFeatured: false,

    sortOrder: 40,
  },
]);

/*
|--------------------------------------------------------------------------
| Seed Collections
|--------------------------------------------------------------------------
|
| Seed Behavior
|
| First run:
| Collection not found
| -> create
|
| Later runs:
| same slug found
| -> reuse existing Collection unchanged
|
| Soft-deleted or inactive seeded Collection:
| -> reuse existing Collection unchanged
| -> do not automatically restore or reactivate it
|
| Existing banner and other catalog edits are preserved.
|
| Real banner images can be uploaded later.
|--------------------------------------------------------------------------
*/

export const seedCollections = async () => {
  const collectionsBySlug = new Map();

  for (const data of COLLECTION_SEED_DATA) {
    const collection = await findOrCreateSeedDocument(
      Collection,
      data.slug,
      () => ({
        ...data,
        status: COLLECTION_STATUSES.ACTIVE,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
        deletedBy: null,
      }),
    );

    collectionsBySlug.set(collection.slug, collection);
  }

  return collectionsBySlug;
};
