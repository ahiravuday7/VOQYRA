import {
  createProduct,
  getAdminProductById,
  getAdminProducts,
  updateProduct,
  deleteProduct,
  restoreProduct,
  getPublicProductBySlug,
  getPublicProducts,
  adjustProductVariantInventory,
  commitProductVariantInventory,
  releaseProductVariantInventory,
  reserveProductVariantInventory,
} from "./product.service.js";

import {
  toAdminProduct,
  toPublicProduct,
  toPublicProductSummary,
} from "./product.mapper.js";

/*
|--------------------------------------------------------------------------
| Map Product Inventory Operation Result
|--------------------------------------------------------------------------
|
| Inventory repository operations return the complete
| updated Product document.
|
| The response includes:
|
| - Complete admin Product response
| - Updated target variant
| - Product-level inventory totals
|--------------------------------------------------------------------------
*/

const mapProductInventoryResult = (product, variantId) => {
  const mappedProduct = toAdminProduct(product);

  const updatedVariant =
    mappedProduct.variants.find((variant) => {
      return variant.id === String(variantId);
    }) ?? null;

  return {
    product: mappedProduct,

    variant: updatedVariant,

    inventorySummary: {
      totalStock: mappedProduct.totalStock,

      reservedStock: mappedProduct.reservedStock,

      availableStock: mappedProduct.availableStock,
    },
  };
};

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

/*
|--------------------------------------------------------------------------
| Adjust Product Variant Inventory
|--------------------------------------------------------------------------
|
| PATCH
| /api/v1/admin/products/:productId/variants/:variantId/inventory
|--------------------------------------------------------------------------
*/

export const adjustProductInventoryController = async (request, response) => {
  const { productId, variantId } = request.validated.params;

  const adjustmentData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await adjustProductVariantInventory(
    productId,
    variantId,
    adjustmentData,
    actorUserId,
  );

  request.log?.info(
    {
      productId,
      variantId,

      quantityDelta: adjustmentData.quantityDelta,

      reason: adjustmentData.reason,

      note: adjustmentData.note ?? null,

      actorUserId,
    },
    "Product inventory adjusted",
  );

  return response.status(200).json({
    success: true,

    message: "Product inventory adjusted successfully",

    data: mapProductInventoryResult(product, variantId),
  });
};

/*
|--------------------------------------------------------------------------
| Reserve Product Variant Inventory
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/products/:productId/variants/:variantId/inventory/reserve
|--------------------------------------------------------------------------
*/

export const reserveProductInventoryController = async (request, response) => {
  const { productId, variantId } = request.validated.params;

  const reservationData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await reserveProductVariantInventory(
    productId,
    variantId,
    reservationData,
    actorUserId,
  );

  request.log?.info(
    {
      productId,
      variantId,

      quantity: reservationData.quantity,

      referenceId: reservationData.referenceId ?? null,

      actorUserId,
    },
    "Product inventory reserved",
  );

  return response.status(200).json({
    success: true,

    message: "Product inventory reserved successfully",

    data: mapProductInventoryResult(product, variantId),
  });
};

/*
|--------------------------------------------------------------------------
| Release Product Variant Reservation
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/products/:productId/variants/:variantId/inventory/release
|--------------------------------------------------------------------------
*/

export const releaseProductInventoryController = async (request, response) => {
  const { productId, variantId } = request.validated.params;

  const releaseData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await releaseProductVariantInventory(
    productId,
    variantId,
    releaseData,
    actorUserId,
  );

  request.log?.info(
    {
      productId,
      variantId,

      quantity: releaseData.quantity,

      referenceId: releaseData.referenceId ?? null,

      actorUserId,
    },
    "Product inventory reservation released",
  );

  return response.status(200).json({
    success: true,

    message: "Product inventory reservation released successfully",

    data: mapProductInventoryResult(product, variantId),
  });
};

/*
|--------------------------------------------------------------------------
| Commit Product Variant Reservation
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/products/:productId/variants/:variantId/inventory/commit
|--------------------------------------------------------------------------
|
| Used when reserved units have been purchased.
|--------------------------------------------------------------------------
*/

export const commitProductInventoryController = async (request, response) => {
  const { productId, variantId } = request.validated.params;

  const commitData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await commitProductVariantInventory(
    productId,
    variantId,
    commitData,
    actorUserId,
  );

  request.log?.info(
    {
      productId,
      variantId,

      quantity: commitData.quantity,

      referenceId: commitData.referenceId ?? null,

      actorUserId,
    },
    "Product reserved inventory committed",
  );

  return response.status(200).json({
    success: true,

    message: "Product reserved inventory committed successfully",

    data: mapProductInventoryResult(product, variantId),
  });
};
