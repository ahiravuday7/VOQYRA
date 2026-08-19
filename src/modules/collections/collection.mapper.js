/*
|--------------------------------------------------------------------------
| Normalize Collection Document
|--------------------------------------------------------------------------
|
| Supports:
|
| - Mongoose documents
| - lean() results
|--------------------------------------------------------------------------
*/

const normalizeCollectionDocument = (collection) => {
  if (!collection) {
    return null;
  }

  if (typeof collection.toObject === "function") {
    return collection.toObject({
      virtuals: true,
    });
  }

  return collection;
};

/*
|--------------------------------------------------------------------------
| Map Reference ID
|--------------------------------------------------------------------------
*/

const mapReferenceId = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map Collection Banner
|--------------------------------------------------------------------------
*/

const mapCollectionBanner = (banner) => {
  if (!banner) {
    return {
      url: "",
      publicId: "",
      altText: "",
    };
  }

  return {
    url: banner.url ?? "",

    publicId: banner.publicId ?? "",

    altText: banner.altText ?? "",
  };
};

/*
|--------------------------------------------------------------------------
| Public Collection Mapper
|--------------------------------------------------------------------------
|
| Public responses must not expose:
|
| - status
| - createdBy
| - updatedBy
| - deletedBy
| - deletedAt
| - internal audit information
|--------------------------------------------------------------------------
*/

export const mapPublicCollection = (collection) => {
  const document = normalizeCollectionDocument(collection);

  if (!document) {
    return null;
  }

  return {
    id: mapReferenceId(document._id),

    name: document.name,

    slug: document.slug,

    description: document.description ?? "",

    banner: mapCollectionBanner(document.banner),

    isFeatured: Boolean(document.isFeatured),

    sortOrder: document.sortOrder ?? 0,
  };
};

/*
|--------------------------------------------------------------------------
| Public Collection List Mapper
|--------------------------------------------------------------------------
*/

export const mapPublicCollections = (collections = []) => {
  return collections.map(mapPublicCollection);
};

/*
|--------------------------------------------------------------------------
| Admin Collection Mapper
|--------------------------------------------------------------------------
|
| Admin responses include management and audit information.
|--------------------------------------------------------------------------
*/

export const mapAdminCollection = (collection) => {
  const document = normalizeCollectionDocument(collection);

  if (!document) {
    return null;
  }

  return {
    id: mapReferenceId(document._id),

    name: document.name,

    slug: document.slug,

    description: document.description ?? "",

    banner: mapCollectionBanner(document.banner),

    status: document.status,

    isFeatured: Boolean(document.isFeatured),

    sortOrder: document.sortOrder ?? 0,

    isDeleted: Boolean(document.deletedAt),

    createdBy: mapReferenceId(document.createdBy),

    updatedBy: mapReferenceId(document.updatedBy),

    deletedBy: mapReferenceId(document.deletedBy),

    deletedAt: document.deletedAt ?? null,

    createdAt: document.createdAt ?? null,

    updatedAt: document.updatedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Collection List Mapper
|--------------------------------------------------------------------------
*/

export const mapAdminCollections = (collections = []) => {
  return collections.map(mapAdminCollection);
};
