import {
  createProduct,
  getAdminProductById,
  getAdminProducts,
  updateProduct,
  deleteProduct,
  restoreProduct,
  getPublicProductBySlug,
  getPublicProducts,
} from "./product.service.js";

import {
  toAdminProduct,
  toPublicProduct,
  toPublicProductSummary,
} from "./product.mapper.js";

/*
|--------------------------------------------------------------------------
| Create Product
|--------------------------------------------------------------------------
|
| Intended route:
|
| POST /api/v1/admin/products
|--------------------------------------------------------------------------
*/

export const createProductController = async (request, response) => {
  const productData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await createProduct(productData, actorUserId);

  request.log?.info(
    {
      productId: product._id,

      productSlug: product.slug,

      actorUserId,
    },
    "Product created",
  );

  return response.status(201).json({
    success: true,

    message: "Product created successfully",

    data: {
      product: toAdminProduct(product),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Products
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/products
|--------------------------------------------------------------------------
*/

export const getAdminProductsController = async (request, response) => {
  const filters = request.validated.query;

  const { products, pagination } = await getAdminProducts(filters);

  return response.status(200).json({
    success: true,

    message: "Products retrieved successfully",

    data: {
      products: products.map((product) => {
        return toAdminProduct(product);
      }),

      pagination,

      filters: {
        search: filters.search ?? null,

        category: filters.category ?? null,

        status: filters.status ?? null,

        isFeatured: filters.isFeatured ?? null,

        isNewArrival: filters.isNewArrival ?? null,

        isBestSeller: filters.isBestSeller ?? null,

        stockStatus: filters.stockStatus ?? null,

        deleted: filters.deleted,

        sortBy: filters.sortBy,

        sortDirection: filters.sortDirection,
      },
    },
  });
};
/*
|--------------------------------------------------------------------------
| Get Admin Product by ID
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/products/:productId
|--------------------------------------------------------------------------
*/

export const getAdminProductController = async (request, response) => {
  const { productId } = request.validated.params;

  const product = await getAdminProductById(productId);

  return response.status(200).json({
    success: true,

    message: "Product retrieved successfully",

    data: {
      product: toAdminProduct(product),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Update Product
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/products/:productId
|--------------------------------------------------------------------------
*/

export const updateProductController = async (request, response) => {
  const { productId } = request.validated.params;

  const updateData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await updateProduct(productId, updateData, actorUserId);

  request.log?.info(
    {
      productId: product._id,

      updatedFields: Object.keys(updateData),

      actorUserId,
    },
    "Product updated",
  );

  return response.status(200).json({
    success: true,

    message: "Product updated successfully",

    data: {
      product: toAdminProduct(product),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Delete Product
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/products/:productId
|--------------------------------------------------------------------------
*/

export const deleteProductController = async (request, response) => {
  const { productId } = request.validated.params;

  const actorUserId = request.user._id;

  const product = await deleteProduct(productId, actorUserId);

  request.log?.info(
    {
      productId: product._id,

      actorUserId,
    },
    "Product deleted",
  );

  return response.status(200).json({
    success: true,

    message: "Product deleted successfully",

    data: {
      product: toAdminProduct(product),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Restore Product
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/products/:productId/restore
|--------------------------------------------------------------------------
*/

export const restoreProductController = async (request, response) => {
  const { productId } = request.validated.params;

  const actorUserId = request.user._id;

  const product = await restoreProduct(productId, actorUserId);

  request.log?.info(
    {
      productId: product._id,

      actorUserId,
    },
    "Product restored",
  );

  return response.status(200).json({
    success: true,

    message: "Product restored successfully",

    data: {
      product: toAdminProduct(product),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Products
|--------------------------------------------------------------------------
|
| GET /api/v1/products
|--------------------------------------------------------------------------
*/

export const getPublicProductsController = async (request, response) => {
  const filters = request.validated.query;

  const { products, pagination } = await getPublicProducts(filters);

  return response.status(200).json({
    success: true,

    message: "Products retrieved successfully",

    data: {
      products: products.map((product) => {
        return toPublicProductSummary(product);
      }),

      pagination,

      filters: {
        search: filters.search ?? null,

        category: filters.category ?? null,

        isFeatured: filters.isFeatured ?? null,

        isNewArrival: filters.isNewArrival ?? null,

        isBestSeller: filters.isBestSeller ?? null,

        inStock: filters.inStock ?? null,

        minPrice: filters.minPrice ?? null,

        maxPrice: filters.maxPrice ?? null,

        sort: filters.sort,
      },
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Product by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/products/:slug
|--------------------------------------------------------------------------
*/

export const getPublicProductController = async (request, response) => {
  const { slug } = request.validated.params;

  const product = await getPublicProductBySlug(slug);

  return response.status(200).json({
    success: true,

    message: "Product retrieved successfully",

    data: {
      product: toPublicProduct(product),
    },
  });
};
