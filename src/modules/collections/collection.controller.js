import {
  createCollection,
  updateCollection,
  getAdminCollection,
  listAdminCollections,
  deleteCollection,
  restoreCollection,
  listPublicCollections,
  getPublicCollectionBySlug,
} from "./collection.service.js";

import {
  mapAdminCollection,
  mapAdminCollections,
  mapPublicCollection,
  mapPublicCollections,
} from "./collection.mapper.js";

/*
|--------------------------------------------------------------------------
| Create Collection
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/collections
|--------------------------------------------------------------------------
*/

export const createCollectionController = async (request, response) => {
  const collectionData = request.validated.body;

  const actorUserId = request.user._id;

  const collection = await createCollection(collectionData, actorUserId);

  request.log?.info(
    {
      collectionId: collection._id,

      collectionSlug: collection.slug,

      actorUserId,
    },
    "Collection created",
  );

  return response.status(201).json({
    success: true,

    message: "Collection created successfully",

    data: {
      collection: mapAdminCollection(collection),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Update Collection
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/collections/:collectionId
|--------------------------------------------------------------------------
*/

export const updateCollectionController = async (request, response) => {
  const { collectionId } = request.validated.params;

  const updateData = request.validated.body;

  const actorUserId = request.user._id;

  const collection = await updateCollection(
    collectionId,
    updateData,
    actorUserId,
  );

  request.log?.info(
    {
      collectionId: collection._id,

      updatedFields: Object.keys(updateData),

      actorUserId,
    },
    "Collection updated",
  );

  return response.status(200).json({
    success: true,

    message: "Collection updated successfully",

    data: {
      collection: mapAdminCollection(collection),
    },
  });
};

/*
|--------------------------------------------------------------------------
| List Admin Collections
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/collections
|--------------------------------------------------------------------------
*/

export const listCollectionsController = async (request, response) => {
  const result = await listAdminCollections(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Collections retrieved successfully",

    data: {
      collections: mapAdminCollections(result.collections),

      pagination: result.pagination,

      filters: result.filters,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Collection
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/collections/:collectionId
|--------------------------------------------------------------------------
*/

export const getCollectionController = async (request, response) => {
  const { collectionId } = request.validated.params;

  const { includeDeleted } = request.validated.query;

  const collection = await getAdminCollection(collectionId, {
    includeDeleted,
  });

  return response.status(200).json({
    success: true,

    message: "Collection retrieved successfully",

    data: {
      collection: mapAdminCollection(collection),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Soft Delete Collection
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/collections/:collectionId
|--------------------------------------------------------------------------
*/

export const deleteCollectionController = async (request, response) => {
  const { collectionId } = request.validated.params;

  const actorUserId = request.user._id;

  const collection = await deleteCollection(collectionId, actorUserId);

  request.log?.info(
    {
      collectionId: collection._id,

      actorUserId,
    },
    "Collection soft deleted",
  );

  return response.status(200).json({
    success: true,

    message: "Collection deleted successfully",

    data: {
      collection: mapAdminCollection(collection),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Restore Collection
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/collections/:collectionId/restore
|--------------------------------------------------------------------------
*/

export const restoreCollectionController = async (request, response) => {
  const { collectionId } = request.validated.params;

  const actorUserId = request.user._id;

  const collection = await restoreCollection(collectionId, actorUserId);

  request.log?.info(
    {
      collectionId: collection._id,

      actorUserId,
    },
    "Collection restored",
  );

  return response.status(200).json({
    success: true,

    message: "Collection restored successfully",

    data: {
      collection: mapAdminCollection(collection),
    },
  });
};

/*
|--------------------------------------------------------------------------
| List Public Collections
|--------------------------------------------------------------------------
|
| GET /api/v1/collections
|--------------------------------------------------------------------------
*/

export const listPublicCollectionsController = async (request, response) => {
  const collections = await listPublicCollections(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Collections retrieved successfully",

    data: {
      collections: mapPublicCollections(collections),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Collection by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/collections/:slug
|--------------------------------------------------------------------------
*/

export const getPublicCollectionController = async (request, response) => {
  const { slug } = request.validated.params;

  const collection = await getPublicCollectionBySlug(slug);

  return response.status(200).json({
    success: true,

    message: "Collection retrieved successfully",

    data: {
      collection: mapPublicCollection(collection),
    },
  });
};
