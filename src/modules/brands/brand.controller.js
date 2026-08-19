import {
  createBrand,
  updateBrand,
  getAdminBrand,
  listAdminBrands,
  deleteBrand,
  restoreBrand,
  listPublicBrands,
  getPublicBrandBySlug,
} from "./brand.service.js";

import {
  mapAdminBrand,
  mapAdminBrands,
  mapPublicBrand,
  mapPublicBrands,
} from "./brand.mapper.js";

/*
|--------------------------------------------------------------------------
| Create Brand
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/brands
|--------------------------------------------------------------------------
*/

export const createBrandController = async (request, response) => {
  const brandData = request.validated.body;

  const actorUserId = request.user._id;

  const brand = await createBrand(brandData, actorUserId);

  request.log?.info(
    {
      brandId: brand._id,

      brandSlug: brand.slug,

      actorUserId,
    },
    "Brand created",
  );

  return response.status(201).json({
    success: true,

    message: "Brand created successfully",

    data: {
      brand: mapAdminBrand(brand),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Update Brand
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/brands/:brandId
|--------------------------------------------------------------------------
*/

export const updateBrandController = async (request, response) => {
  const { brandId } = request.validated.params;

  const updateData = request.validated.body;

  const actorUserId = request.user._id;

  const brand = await updateBrand(brandId, updateData, actorUserId);

  request.log?.info(
    {
      brandId: brand._id,

      updatedFields: Object.keys(updateData),

      actorUserId,
    },
    "Brand updated",
  );

  return response.status(200).json({
    success: true,

    message: "Brand updated successfully",

    data: {
      brand: mapAdminBrand(brand),
    },
  });
};

/*
|--------------------------------------------------------------------------
| List Admin Brands
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/brands
|--------------------------------------------------------------------------
*/

export const listBrandsController = async (request, response) => {
  const result = await listAdminBrands(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Brands retrieved successfully",

    data: {
      brands: mapAdminBrands(result.brands),

      pagination: result.pagination,

      filters: result.filters,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Brand
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/brands/:brandId
|--------------------------------------------------------------------------
*/

export const getBrandController = async (request, response) => {
  const { brandId } = request.validated.params;

  const { includeDeleted } = request.validated.query;

  const brand = await getAdminBrand(brandId, {
    includeDeleted,
  });

  return response.status(200).json({
    success: true,

    message: "Brand retrieved successfully",

    data: {
      brand: mapAdminBrand(brand),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Delete Brand
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/brands/:brandId
|--------------------------------------------------------------------------
|
| This performs a soft deletion.
|--------------------------------------------------------------------------
*/

export const deleteBrandController = async (request, response) => {
  const { brandId } = request.validated.params;

  const actorUserId = request.user._id;

  const brand = await deleteBrand(brandId, actorUserId);

  request.log?.info(
    {
      brandId: brand._id,

      actorUserId,
    },
    "Brand soft deleted",
  );

  return response.status(200).json({
    success: true,

    message: "Brand deleted successfully",

    data: {
      brand: mapAdminBrand(brand),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Restore Brand
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/brands/:brandId/restore
|--------------------------------------------------------------------------
*/

export const restoreBrandController = async (request, response) => {
  const { brandId } = request.validated.params;

  const actorUserId = request.user._id;

  const brand = await restoreBrand(brandId, actorUserId);

  request.log?.info(
    {
      brandId: brand._id,

      actorUserId,
    },
    "Brand restored",
  );

  return response.status(200).json({
    success: true,

    message: "Brand restored successfully",

    data: {
      brand: mapAdminBrand(brand),
    },
  });
};

/*
|--------------------------------------------------------------------------
| List Public Brands
|--------------------------------------------------------------------------
|
| GET /api/v1/brands
|--------------------------------------------------------------------------
*/

export const listPublicBrandsController = async (request, response) => {
  const brands = await listPublicBrands(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Brands retrieved successfully",

    data: {
      brands: mapPublicBrands(brands),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Brand by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/brands/:slug
|--------------------------------------------------------------------------
*/

export const getPublicBrandController = async (request, response) => {
  const { slug } = request.validated.params;

  const brand = await getPublicBrandBySlug(slug);

  return response.status(200).json({
    success: true,

    message: "Brand retrieved successfully",

    data: {
      brand: mapPublicBrand(brand),
    },
  });
};
