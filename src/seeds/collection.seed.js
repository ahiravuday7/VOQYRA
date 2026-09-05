import Collection from "../modules/collections/collection.model.js";

import { COLLECTION_STATUSES } from "../shared/constants/collection.constants.js";

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
| Idempotency:
|
| First run:
| Collection not found
| → create
|
| Later runs:
| same slug found
| → update/reuse
|
| Soft-deleted seeded Collection:
| → restore
|
| We intentionally do NOT overwrite banner.
| Real banner images can be uploaded later.
|
*/

export const seedCollections = async () => {
  const collectionsBySlug = new Map();

  for (const collectionData of COLLECTION_SEED_DATA) {
    const collection = await Collection.findOneAndUpdate(
      {
        slug: collectionData.slug,
      },

      {
        $set: {
          ...collectionData,

          status: COLLECTION_STATUSES.ACTIVE,

          /*
           * Restore this development seed Collection
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

    collectionsBySlug.set(
      collection.slug,

      collection,
    );
  }

  /*
   * Product seed will later use:
   *
   * collectionsBySlug
   *   .get("new-arrivals")
   *   ._id
   *
   * or:
   *
   * collections: [
   *   collectionsBySlug.get("new-arrivals")._id,
   *   collectionsBySlug.get("best-sellers")._id,
   * ]
   */
  return collectionsBySlug;
};
