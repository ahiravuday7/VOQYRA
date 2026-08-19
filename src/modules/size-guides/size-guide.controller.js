import {
  createSizeGuide,
  updateSizeGuide,
  getAdminSizeGuide,
  listAdminSizeGuides,
  deleteSizeGuide,
  restoreSizeGuide,
  listPublicSizeGuides,
  getPublicSizeGuideBySlug,
} from "./size-guide.service.js";

import {
  mapAdminSizeGuide,
  mapAdminSizeGuides,
  mapPublicSizeGuide,
  mapPublicSizeGuides,
} from "./size-guide.mapper.js";

/*
|--------------------------------------------------------------------------
| Create SizeGuide
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/size-guides
|--------------------------------------------------------------------------
*/

export const createSizeGuideController = async (request, response) => {
  const sizeGuideData = request.validated.body;

  const actorUserId = request.user._id;

  const sizeGuide = await createSizeGuide(sizeGuideData, actorUserId);

  request.log?.info(
    {
      sizeGuideId: sizeGuide._id,

      sizeGuideSlug: sizeGuide.slug,

      actorUserId,
    },
    "Size guide created",
  );

  return response.status(201).json({
    success: true,

    message: "Size guide created successfully",

    data: {
      sizeGuide: mapAdminSizeGuide(sizeGuide),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Update SizeGuide
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/size-guides/:sizeGuideId
|--------------------------------------------------------------------------
*/

export const updateSizeGuideController = async (request, response) => {
  const { sizeGuideId } = request.validated.params;

  const updateData = request.validated.body;

  const actorUserId = request.user._id;

  const sizeGuide = await updateSizeGuide(sizeGuideId, updateData, actorUserId);

  request.log?.info(
    {
      sizeGuideId: sizeGuide._id,

      updatedFields: Object.keys(updateData),

      actorUserId,
    },
    "Size guide updated",
  );

  return response.status(200).json({
    success: true,

    message: "Size guide updated successfully",

    data: {
      sizeGuide: mapAdminSizeGuide(sizeGuide),
    },
  });
};

/*
|--------------------------------------------------------------------------
| List Admin SizeGuides
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/size-guides
|--------------------------------------------------------------------------
*/

export const listSizeGuidesController = async (request, response) => {
  const result = await listAdminSizeGuides(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Size guides retrieved successfully",

    data: {
      sizeGuides: mapAdminSizeGuides(result.sizeGuides),

      pagination: result.pagination,

      filters: result.filters,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin SizeGuide
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/size-guides/:sizeGuideId
|--------------------------------------------------------------------------
*/

export const getSizeGuideController = async (request, response) => {
  const { sizeGuideId } = request.validated.params;

  const { includeDeleted } = request.validated.query;

  const sizeGuide = await getAdminSizeGuide(sizeGuideId, {
    includeDeleted,
  });

  return response.status(200).json({
    success: true,

    message: "Size guide retrieved successfully",

    data: {
      sizeGuide: mapAdminSizeGuide(sizeGuide),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Soft Delete SizeGuide
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/size-guides/:sizeGuideId
|--------------------------------------------------------------------------
*/

export const deleteSizeGuideController = async (request, response) => {
  const { sizeGuideId } = request.validated.params;

  const actorUserId = request.user._id;

  const sizeGuide = await deleteSizeGuide(sizeGuideId, actorUserId);

  request.log?.info(
    {
      sizeGuideId: sizeGuide._id,

      actorUserId,
    },
    "Size guide soft deleted",
  );

  return response.status(200).json({
    success: true,

    message: "Size guide deleted successfully",

    data: {
      sizeGuide: mapAdminSizeGuide(sizeGuide),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Restore SizeGuide
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/size-guides/:sizeGuideId/restore
|--------------------------------------------------------------------------
*/

export const restoreSizeGuideController = async (request, response) => {
  const { sizeGuideId } = request.validated.params;

  const actorUserId = request.user._id;

  const sizeGuide = await restoreSizeGuide(sizeGuideId, actorUserId);

  request.log?.info(
    {
      sizeGuideId: sizeGuide._id,

      actorUserId,
    },
    "Size guide restored",
  );

  return response.status(200).json({
    success: true,

    message: "Size guide restored successfully",

    data: {
      sizeGuide: mapAdminSizeGuide(sizeGuide),
    },
  });
};

/*
|--------------------------------------------------------------------------
| List Public SizeGuides
|--------------------------------------------------------------------------
|
| GET /api/v1/size-guides
|--------------------------------------------------------------------------
*/

export const listPublicSizeGuidesController = async (request, response) => {
  const sizeGuides = await listPublicSizeGuides(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Size guides retrieved successfully",

    data: {
      sizeGuides: mapPublicSizeGuides(sizeGuides),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public SizeGuide by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/size-guides/:slug
|--------------------------------------------------------------------------
*/

export const getPublicSizeGuideController = async (request, response) => {
  const { slug } = request.validated.params;

  const sizeGuide = await getPublicSizeGuideBySlug(slug);

  return response.status(200).json({
    success: true,

    message: "Size guide retrieved successfully",

    data: {
      sizeGuide: mapPublicSizeGuide(sizeGuide),
    },
  });
};
