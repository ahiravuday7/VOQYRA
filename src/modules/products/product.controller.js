import {
  createProduct,
  getAdminProductById,
  getAdminProducts,
} from "./product.service.js";

import { toAdminProduct } from "./product.mapper.js";

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
