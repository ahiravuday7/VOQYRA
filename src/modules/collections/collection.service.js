import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import {
  createCollectionDocument,
  findCollectionById,
  findCollectionBySlug,
  saveCollectionDocument,
  findCollections,
  countCollections,
  findPublicCollections,
  findPublicCollectionBySlug,
} from "./collection.repository.js";

/*
|--------------------------------------------------------------------------
| Collection Errors
|--------------------------------------------------------------------------
*/

const createCollectionNotFoundError = () => {
  return new AppError("Collection was not found", 404, {
    errorCode: "COLLECTION_NOT_FOUND",
  });
};

const createDuplicateSlugError = () => {
  return new AppError("A collection with this slug already exists", 409, {
    errorCode: "COLLECTION_SLUG_ALREADY_EXISTS",
  });
};

/*
|--------------------------------------------------------------------------
| Ensure Collection Slug Is Available
|--------------------------------------------------------------------------
|
| Slugs remain reserved even after soft deletion.
|--------------------------------------------------------------------------
*/

const ensureCollectionSlugIsAvailable = async (slug, options = {}) => {
  const existingCollection = await findCollectionBySlug(slug, options);

  if (existingCollection) {
    throw createDuplicateSlugError();
  }
};

/*
|--------------------------------------------------------------------------
| Create Collection
|--------------------------------------------------------------------------
*/

export const createCollection = async (collectionData, actorUserId) => {
  await ensureCollectionSlugIsAvailable(collectionData.slug);

  const collection = await createCollectionDocument({
    ...collectionData,

    createdBy: actorUserId,

    updatedBy: actorUserId,
  });

  return collection;
};

/*
|--------------------------------------------------------------------------
| Update Collection
|--------------------------------------------------------------------------
*/

export const updateCollection = async (
  collectionId,
  updateData,
  actorUserId,
) => {
  let updatedCollection = null;

  await mongoose.connection.transaction(async (session) => {
    const collection = await findCollectionById(collectionId, {
      session,
    });

    if (!collection) {
      throw createCollectionNotFoundError();
    }

    /*
      |--------------------------------------------------------------------------
      | Validate Slug
      |--------------------------------------------------------------------------
      */

    if (updateData.slug && updateData.slug !== collection.slug) {
      await ensureCollectionSlugIsAvailable(updateData.slug, {
        excludeCollectionId: collection._id,

        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Update Normal Fields
      |--------------------------------------------------------------------------
      */

    const editableFields = [
      "name",
      "slug",
      "description",
      "status",
      "isFeatured",
      "sortOrder",
    ];

    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        collection[field] = updateData[field];
      }
    }

    /*
      |--------------------------------------------------------------------------
      | Update Banner
      |--------------------------------------------------------------------------
      |
      | Banner is merged instead of replaced.
      |
      | Existing:
      |
      | {
      |   url: "...",
      |   publicId: "...",
      |   altText: "Festive Collection"
      | }
      |
      | PATCH:
      |
      | {
      |   "banner": {
      |     "altText": "Festive styles"
      |   }
      | }
      |
      | Result:
      |
      | url and publicId remain unchanged.
      |--------------------------------------------------------------------------
      */

    if (Object.prototype.hasOwnProperty.call(updateData, "banner")) {
      const existingBanner =
        typeof collection.banner?.toObject === "function"
          ? collection.banner.toObject()
          : (collection.banner ?? {});

      collection.banner = {
        ...existingBanner,

        ...updateData.banner,
      };
    }

    collection.updatedBy = actorUserId;

    await saveCollectionDocument(collection, {
      session,
    });

    updatedCollection = collection;
  });

  return updatedCollection;
};

/*
|--------------------------------------------------------------------------
| Get Admin Collection
|--------------------------------------------------------------------------
*/

export const getAdminCollection = async (collectionId, options = {}) => {
  const { includeDeleted = false } = options;

  const collection = await findCollectionById(collectionId, {
    includeDeleted,
  });

  if (!collection) {
    throw createCollectionNotFoundError();
  }

  return collection;
};

/*
|--------------------------------------------------------------------------
| Escape Search Regular Expression
|--------------------------------------------------------------------------
|
| User-controlled search text must be treated as literal text.
|
| Example:
|
| Summer.*
|
| must not become executable regex syntax.
|--------------------------------------------------------------------------
*/

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| List Admin Collections
|--------------------------------------------------------------------------
*/

export const listAdminCollections = async (queryData) => {
  const {
    page,
    limit,
    search,
    status,
    isFeatured,
    deleted,
    sortBy,
    sortDirection,
  } = queryData;

  const filter = {};

  /*
    |--------------------------------------------------------------------------
    | Deleted Filter
    |--------------------------------------------------------------------------
    */

  if (deleted === "exclude") {
    filter.deletedAt = null;
  }

  if (deleted === "only") {
    filter.deletedAt = {
      $ne: null,
    };
  }

  /*
   * deleted === "include"
   *
   * No deletedAt condition.
   */

  /*
    |--------------------------------------------------------------------------
    | Status Filter
    |--------------------------------------------------------------------------
    */

  if (status) {
    filter.status = status;
  }

  /*
    |--------------------------------------------------------------------------
    | Featured Filter
    |--------------------------------------------------------------------------
    */

  if (typeof isFeatured === "boolean") {
    filter.isFeatured = isFeatured;
  }

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

  if (search) {
    const escapedSearch = escapeRegularExpression(search);

    const searchExpression = new RegExp(escapedSearch, "i");

    filter.$or = [
      {
        name: searchExpression,
      },

      {
        slug: searchExpression,
      },

      {
        description: searchExpression,
      },
    ];
  }

  /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

  const skip = (page - 1) * limit;

  /*
    |--------------------------------------------------------------------------
    | Sorting
    |--------------------------------------------------------------------------
    */

  const direction = sortDirection === "desc" ? -1 : 1;

  const sort = {
    [sortBy]: direction,
  };

  /*
   * Add stable secondary sorting.
   */
  if (sortBy !== "name") {
    sort.name = 1;
  }

  sort._id = direction;

  /*
    |--------------------------------------------------------------------------
    | Execute Queries
    |--------------------------------------------------------------------------
    */

  const [collections, totalItems] = await Promise.all([
    findCollections(filter, {
      skip,
      limit,
      sort,
    }),

    countCollections(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    collections,

    pagination: {
      page,

      limit,

      totalItems,

      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },

    filters: {
      search: search ?? null,

      status: status ?? null,

      isFeatured: typeof isFeatured === "boolean" ? isFeatured : null,

      deleted,

      sortBy,

      sortDirection,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Soft Delete Collection
|--------------------------------------------------------------------------
|
| Delete is idempotent.
|
| Calling DELETE multiple times keeps the original deletion metadata.
|--------------------------------------------------------------------------
*/

export const deleteCollection = async (collectionId, actorUserId) => {
  let deletedCollection = null;

  await mongoose.connection.transaction(async (session) => {
    const collection = await findCollectionById(collectionId, {
      session,

      includeDeleted: true,
    });

    if (!collection) {
      throw createCollectionNotFoundError();
    }

    /*
     * Already deleted.
     */
    if (collection.deletedAt) {
      deletedCollection = collection;

      return;
    }

    collection.deletedAt = new Date();

    collection.deletedBy = actorUserId;

    collection.updatedBy = actorUserId;

    await saveCollectionDocument(collection, {
      session,
    });

    deletedCollection = collection;
  });

  return deletedCollection;
};

/*
|--------------------------------------------------------------------------
| Restore Collection
|--------------------------------------------------------------------------
|
| Restore is idempotent.
|--------------------------------------------------------------------------
*/

export const restoreCollection = async (collectionId, actorUserId) => {
  let restoredCollection = null;

  await mongoose.connection.transaction(async (session) => {
    const collection = await findCollectionById(collectionId, {
      session,

      includeDeleted: true,
    });

    if (!collection) {
      throw createCollectionNotFoundError();
    }

    /*
     * Already restored.
     */
    if (!collection.deletedAt) {
      restoredCollection = collection;

      return;
    }

    collection.deletedAt = null;

    collection.deletedBy = null;

    collection.updatedBy = actorUserId;

    await saveCollectionDocument(collection, {
      session,
    });

    restoredCollection = collection;
  });

  return restoredCollection;
};

/*
|--------------------------------------------------------------------------
| List Public Collections
|--------------------------------------------------------------------------
|
| Repository automatically enforces:
|
| status = active
| deletedAt = null
|--------------------------------------------------------------------------
*/

export const listPublicCollections = async (queryData) => {
  const { isFeatured } = queryData;

  const filter = {};

  if (typeof isFeatured === "boolean") {
    filter.isFeatured = isFeatured;
  }

  return findPublicCollections(filter);
};

/*
|--------------------------------------------------------------------------
| Get Public Collection by Slug
|--------------------------------------------------------------------------
|
| Inactive and deleted Collections appear as not found publicly.
|--------------------------------------------------------------------------
*/

export const getPublicCollectionBySlug = async (slug) => {
  const collection = await findPublicCollectionBySlug(slug);

  if (!collection) {
    throw createCollectionNotFoundError();
  }

  return collection;
};
