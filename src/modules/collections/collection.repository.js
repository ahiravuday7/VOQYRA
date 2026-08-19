import Collection from "./collection.model.js";

import { COLLECTION_STATUSES } from "../../shared/constants/collection.constants.js";

/*
|--------------------------------------------------------------------------
| Find Collection by ID
|--------------------------------------------------------------------------
*/

export const findCollectionById = (collectionId, options = {}) => {
  const { session = null, includeDeleted = false } = options;

  const filter = {
    _id: collectionId,
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  const query = Collection.findOne(filter);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Collection by Slug
|--------------------------------------------------------------------------
|
| Deleted collections are intentionally included.
|
| The slug is globally unique, so a soft-deleted Collection continues
| to own its slug.
|--------------------------------------------------------------------------
*/

export const findCollectionBySlug = (slug, options = {}) => {
  const { excludeCollectionId = null, session = null } = options;

  const filter = {
    slug,
  };

  if (excludeCollectionId) {
    filter._id = {
      $ne: excludeCollectionId,
    };
  }

  const query = Collection.findOne(filter).select("_id slug deletedAt").lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Create Collection Document
|--------------------------------------------------------------------------
*/

export const createCollectionDocument = (collectionData, options = {}) => {
  const { session = null } = options;

  const collection = new Collection(collectionData);

  const saveOptions = session ? { session } : {};

  return collection.save(saveOptions);
};

/*
|--------------------------------------------------------------------------
| Save Collection Document
|--------------------------------------------------------------------------
|
| Used later for:
|
| - update
| - soft delete
| - restore
|--------------------------------------------------------------------------
*/

export const saveCollectionDocument = (collection, options = {}) => {
  const { session = null } = options;

  const saveOptions = session ? { session } : {};

  return collection.save(saveOptions);
};

/*
|--------------------------------------------------------------------------
| Find Collections
|--------------------------------------------------------------------------
|
| Used by the future admin listing service.
|
| The Service will build:
|
| - search
| - status
| - featured filter
| - deleted filter
| - pagination
| - sorting
|--------------------------------------------------------------------------
*/

export const findCollections = (filter, options = {}) => {
  const {
    skip = 0,

    limit = 20,

    sort = {
      sortOrder: 1,
      name: 1,
      _id: 1,
    },
  } = options;

  return Collection.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

/*
|--------------------------------------------------------------------------
| Count Collections
|--------------------------------------------------------------------------
*/

export const countCollections = (filter) => {
  return Collection.countDocuments(filter);
};

/*
|--------------------------------------------------------------------------
| Find Public Collections
|--------------------------------------------------------------------------
|
| Public Collections must always be:
|
| status = active
| deletedAt = null
|
| Internal audit fields are excluded.
|--------------------------------------------------------------------------
*/

export const findPublicCollections = (filter = {}) => {
  return Collection.find({
    ...filter,

    status: COLLECTION_STATUSES.ACTIVE,

    deletedAt: null,
  })
    .select(
      ["name", "slug", "description", "banner", "isFeatured", "sortOrder"].join(
        " ",
      ),
    )
    .sort({
      sortOrder: 1,
      name: 1,
      _id: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| Find Public Collection by Slug
|--------------------------------------------------------------------------
*/

export const findPublicCollectionBySlug = (slug) => {
  return Collection.findOne({
    slug,

    status: COLLECTION_STATUSES.ACTIVE,

    deletedAt: null,
  })
    .select(
      ["name", "slug", "description", "banner", "isFeatured", "sortOrder"].join(
        " ",
      ),
    )
    .lean();
};
