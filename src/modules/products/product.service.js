import mongoose from "mongoose";

import { CATEGORY_STATUSES } from "../../shared/constants/category.constants.js";

import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { PRODUCT_INVENTORY_OPERATIONS } from "../../shared/constants/product-inventory.constants.js";

import { createProductInventoryLedgerEntry } from "./product-inventory-ledger.repository.js";

import {
  findCategoriesByIds,
  findCategoryById,
} from "../categories/category.repository.js";

import {
  createProductDocument,
  findProductById,
  findProductBySlug,
  findProductsByVariantSkus,
  listAdminProducts,
  saveProductDocument,
  findPublicProductBySlug,
  listPublicProducts,
  adjustVariantStockAtomically,
  commitVariantStockAtomically,
  findProductVariantInventorySnapshot,
  releaseVariantStockAtomically,
  reserveVariantStockAtomically,
} from "./product.repository.js";

import { BRAND_STATUSES } from "../../shared/constants/brand.constants.js";

import { SIZE_GUIDE_STATUSES } from "../../shared/constants/size-guide.constants.js";

import { findBrandById } from "../brands/brand.repository.js";

import { findSizeGuideById } from "../size-guides/size-guide.repository.js";

import { findCollectionsByIds } from "../collections/collection.repository.js";

/*
|--------------------------------------------------------------------------
| Product Errors
|--------------------------------------------------------------------------
*/

const createProductCategoryNotFoundError = () => {
  return new AppError("Product category was not found", 400, {
    errorCode: "PRODUCT_CATEGORY_NOT_FOUND",
  });
};

const createProductSlugConflictError = () => {
  return new AppError("A product with this slug already exists", 409, {
    errorCode: "PRODUCT_SLUG_ALREADY_EXISTS",
  });
};

const createProductNotFoundError = () => {
  return new AppError("Product was not found", 404, {
    errorCode: "PRODUCT_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Product Inventory Errors
|--------------------------------------------------------------------------
*/

const createProductVariantNotFoundError = () => {
  return new AppError("Product variant was not found", 404, {
    errorCode: "PRODUCT_VARIANT_NOT_FOUND",
  });
};

const createInactiveProductInventoryError = () => {
  return new AppError("Stock cannot be reserved for an inactive Product", 409, {
    errorCode: "PRODUCT_INACTIVE",
  });
};

const createInactiveVariantInventoryError = () => {
  return new AppError(
    "Stock cannot be reserved for an inactive Product variant",
    409,
    {
      errorCode: "PRODUCT_VARIANT_INACTIVE",
    },
  );
};

const createInsufficientAvailableStockError = ({
  requestedQuantity,
  stock,
  reservedStock,
  availableStock,
}) => {
  return new AppError("Insufficient available stock", 409, {
    errorCode: "PRODUCT_INSUFFICIENT_AVAILABLE_STOCK",

    details: {
      requestedQuantity,
      stock,
      reservedStock,
      availableStock,
    },
  });
};

const createInsufficientReservedStockError = ({
  requestedQuantity,
  stock,
  reservedStock,
  availableStock,
}) => {
  return new AppError("Insufficient reserved stock", 409, {
    errorCode: "PRODUCT_INSUFFICIENT_RESERVED_STOCK",

    details: {
      requestedQuantity,
      stock,
      reservedStock,
      availableStock,
    },
  });
};

const createUnsafeStockAdjustmentError = ({
  quantityDelta,
  stock,
  reservedStock,
  resultingStock,
}) => {
  return new AppError(
    "Inventory adjustment would reduce physical stock below reserved stock",
    409,
    {
      errorCode: "PRODUCT_STOCK_ADJUSTMENT_CONFLICT",

      details: {
        quantityDelta,
        stock,
        reservedStock,
        resultingStock,
      },
    },
  );
};

const createInventoryInconsistentError = ({
  requestedQuantity,
  stock,
  reservedStock,
}) => {
  return new AppError("Product inventory is inconsistent", 409, {
    errorCode: "PRODUCT_INVENTORY_INCONSISTENT",

    details: {
      requestedQuantity,
      stock,
      reservedStock,
    },
  });
};

const createInventoryConflictError = () => {
  return new AppError(
    "Product inventory changed while the operation was being processed",
    409,
    {
      errorCode: "PRODUCT_INVENTORY_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Product Brand Errors
|--------------------------------------------------------------------------
*/

const createProductBrandNotFoundError = () => {
  return new AppError("Product brand was not found", 400, {
    errorCode: "PRODUCT_BRAND_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Product Size Guide Errors
|--------------------------------------------------------------------------
*/

const createProductSizeGuideNotFoundError = () => {
  return new AppError("Product size guide was not found", 400, {
    errorCode: "PRODUCT_SIZE_GUIDE_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Product Collection Errors
|--------------------------------------------------------------------------
*/

const createProductCollectionNotFoundError = (collectionIds) => {
  return new AppError("One or more Product collections were not found", 400, {
    errorCode: "PRODUCT_COLLECTION_NOT_FOUND",

    details: {
      collectionIds,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Product Variant Inventory Snapshot
|--------------------------------------------------------------------------
|
| This helper is called after an atomic operation returns null.
|
| It determines whether:
|
| - The Product does not exist.
| - The Product is deleted.
| - The variant does not exist.
| - The inventory condition failed.
|--------------------------------------------------------------------------
*/

const getProductVariantInventorySnapshot = async (
  productId,
  variantId,
  session,
) => {
  const snapshot = await findProductVariantInventorySnapshot(
    productId,
    variantId,
    {
      session,
    },
  );

  if (!snapshot || snapshot.isDeleted) {
    throw createProductNotFoundError();
  }

  if (!snapshot.variant) {
    throw createProductVariantNotFoundError();
  }

  return snapshot;
};

/*
|--------------------------------------------------------------------------
| Execute Product Inventory Transaction
|--------------------------------------------------------------------------
|
| The callback may be retried automatically by MongoDB
| when a transient transaction conflict occurs.
|--------------------------------------------------------------------------
*/

const executeProductInventoryTransaction = async (operation) => {
  const session = await mongoose.startSession();

  try {
    let operationResult;

    await session.withTransaction(async () => {
      operationResult = await operation(session);
    });

    return operationResult;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Build Inventory State
|--------------------------------------------------------------------------
*/

const buildInventoryState = (stock, reservedStock) => {
  return {
    stock,

    reservedStock,

    availableStock: stock - reservedStock,
  };
};

/*
|--------------------------------------------------------------------------
| Find Updated Product Variant
|--------------------------------------------------------------------------
*/

const findUpdatedProductVariant = (product, variantId) => {
  const variant = (product.variants ?? []).find((item) => {
    return String(item._id) === String(variantId);
  });

  if (!variant) {
    /*
     * This should never occur after a successful
     * atomic update, but remains a defensive check.
     */
    throw createProductVariantNotFoundError();
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Create Inventory Ledger for Updated Product
|--------------------------------------------------------------------------
|
| The atomic Product update returns the after-state.
|
| The before-state can safely be reconstructed:
|
| before stock =
| after stock - stockDelta
|
| before reserved =
| after reserved - reservedStockDelta
|--------------------------------------------------------------------------
*/

const createInventoryLedgerForUpdatedProduct = async ({
  product,
  variantId,
  operation,
  quantity,
  stockDelta,
  reservedStockDelta,
  reason,
  note,
  referenceId,
  actorUserId,
  session,
}) => {
  const variant = findUpdatedProductVariant(product, variantId);

  const afterStock = variant.inventory?.stock ?? 0;

  const afterReservedStock = variant.inventory?.reservedStock ?? 0;

  const beforeStock = afterStock - stockDelta;

  const beforeReservedStock = afterReservedStock - reservedStockDelta;

  return createProductInventoryLedgerEntry(
    {
      product: product._id,

      variantId: variant._id,

      sku: variant.sku,

      operation,

      quantity,

      stockDelta,

      reservedStockDelta,

      before: buildInventoryState(beforeStock, beforeReservedStock),

      after: buildInventoryState(afterStock, afterReservedStock),

      reason: reason ?? undefined,

      note: note ?? undefined,

      referenceId: referenceId ?? undefined,

      actor: actorUserId,
    },

    session,
  );
};

/*
|--------------------------------------------------------------------------
| Object ID Normalizer
|--------------------------------------------------------------------------
*/

const objectIdToString = (value) => {
  return String(value);
};

/*
|--------------------------------------------------------------------------
| Normalize Variant SKUs
|--------------------------------------------------------------------------
*/

const extractNormalizedSkus = (variants) => {
  return (variants ?? []).map((variant) => {
    return variant.sku.trim().toUpperCase();
  });
};

/*
|--------------------------------------------------------------------------
| Ensure Product Slug Is Available
|--------------------------------------------------------------------------
*/

const ensureProductSlugIsAvailable = async (slug, options = {}) => {
  const existingProduct = await findProductBySlug(slug, options);

  if (existingProduct) {
    throw createProductSlugConflictError();
  }
};

/*
|--------------------------------------------------------------------------
| Ensure Variant SKUs Are Available
|--------------------------------------------------------------------------
*/

const ensureProductSkusAreAvailable = async (variants, options = {}) => {
  const requestedSkus = extractNormalizedSkus(variants);

  if (!requestedSkus.length) {
    return;
  }

  const matchingProducts = await findProductsByVariantSkus(
    requestedSkus,
    options,
  );

  if (!matchingProducts.length) {
    return;
  }

  const requestedSkuSet = new Set(requestedSkus);

  const conflictingSkus = [
    ...new Set(
      matchingProducts.flatMap((product) => {
        return (product.variants ?? [])
          .map((variant) => {
            return variant.sku?.trim().toUpperCase();
          })
          .filter((sku) => {
            return sku && requestedSkuSet.has(sku);
          });
      }),
    ),
  ];

  throw new AppError("One or more product variant SKUs already exist", 409, {
    errorCode: "PRODUCT_SKU_ALREADY_EXISTS",

    details: {
      conflictingSkus,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Check Category Ancestor Path
|--------------------------------------------------------------------------
*/

const ensureCategoryAncestorsAreActive = async (ancestorIds, options = {}) => {
  if (!ancestorIds?.length) {
    return;
  }

  const { session = null } = options;

  const normalizedAncestorIds = [...new Set(ancestorIds.map(objectIdToString))];

  const ancestors = await findCategoriesByIds(normalizedAncestorIds, {
    session,
    includeDeleted: true,
  });

  const ancestorMap = new Map(
    ancestors.map((ancestor) => {
      return [objectIdToString(ancestor._id), ancestor];
    }),
  );

  const invalidAncestorId = normalizedAncestorIds.find((ancestorId) => {
    const ancestor = ancestorMap.get(ancestorId);

    return (
      !ancestor ||
      ancestor.deletedAt ||
      ancestor.status !== CATEGORY_STATUSES.ACTIVE
    );
  });

  if (invalidAncestorId) {
    throw new AppError(
      "An active product requires every category ancestor to be active",
      409,
      {
        errorCode: "PRODUCT_CATEGORY_ANCESTOR_UNAVAILABLE",

        details: {
          categoryId: invalidAncestorId,
        },
      },
    );
  }
};

/*
|--------------------------------------------------------------------------
| Validate Product Category
|--------------------------------------------------------------------------
*/

const validateProductCategory = async (
  categoryId,
  productStatus,
  options = {},
) => {
  const { session = null } = options;

  const category = await findCategoryById(categoryId, {
    session,
  });

  if (!category) {
    throw createProductCategoryNotFoundError();
  }

  /*
   * Draft, inactive and archived products may be
   * prepared using an inactive category.
   *
   * Active products require a completely active
   * public category path.
   */
  if (productStatus !== PRODUCT_STATUSES.ACTIVE) {
    return category;
  }

  if (category.status !== CATEGORY_STATUSES.ACTIVE) {
    throw new AppError("An active product requires an active category", 409, {
      errorCode: "PRODUCT_CATEGORY_INACTIVE",
    });
  }

  await ensureCategoryAncestorsAreActive(category.ancestors, {
    session,
  });

  return category;
};

/*
|--------------------------------------------------------------------------
| Validate Product Brand
|--------------------------------------------------------------------------
|
| Rules:
|
| Every Product:
| - Brand must exist.
| - Brand must not be deleted.
|
| Active Product:
| - Brand must also be active.
|--------------------------------------------------------------------------
*/

const validateProductBrand = async (brandId, productStatus, options = {}) => {
  const { session = null } = options;

  const brand = await findBrandById(brandId, {
    session,
  });

  /*
   * Repository excludes soft-deleted Brands,
   * so deleted and missing Brand references
   * are treated as unavailable.
   */
  if (!brand) {
    throw createProductBrandNotFoundError();
  }

  if (
    productStatus === PRODUCT_STATUSES.ACTIVE &&
    brand.status !== BRAND_STATUSES.ACTIVE
  ) {
    throw new AppError("An active Product requires an active Brand", 409, {
      errorCode: "PRODUCT_BRAND_INACTIVE",
    });
  }

  return brand;
};

/*
|--------------------------------------------------------------------------
| Validate Product Size Guide
|--------------------------------------------------------------------------
|
| SizeGuide is optional.
|
| When supplied:
|
| - It must exist.
| - It must not be deleted.
| - Its Category must be compatible with the Product Category.
|
| Active Product:
|
| - SizeGuide must also be active.
|--------------------------------------------------------------------------
*/

const validateProductSizeGuide = async (
  sizeGuideId,
  productCategory,
  productStatus,
  options = {},
) => {
  /*
   * SizeGuide is optional.
   */
  if (!sizeGuideId) {
    return null;
  }

  const { session = null } = options;

  const sizeGuide = await findSizeGuideById(sizeGuideId, {
    session,
  });

  if (!sizeGuide) {
    throw createProductSizeGuideNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Active Product → Active SizeGuide
    |--------------------------------------------------------------------------
    */

  if (
    productStatus === PRODUCT_STATUSES.ACTIVE &&
    sizeGuide.status !== SIZE_GUIDE_STATUSES.ACTIVE
  ) {
    throw new AppError("An active Product requires an active Size Guide", 409, {
      errorCode: "PRODUCT_SIZE_GUIDE_INACTIVE",
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Generic SizeGuide
    |--------------------------------------------------------------------------
    |
    | category = null
    |
    | Can be used by any Product.
    |--------------------------------------------------------------------------
    */

  if (!sizeGuide.category) {
    return sizeGuide;
  }

  /*
    |--------------------------------------------------------------------------
    | Category Compatibility
    |--------------------------------------------------------------------------
    |
    | A SizeGuide may belong to:
    |
    | 1. The exact Product Category
    |
    | OR
    |
    | 2. Any ancestor of the Product Category.
    |
    | Example:
    |
    | Men
    |   └── Topwear
    |        └── T-Shirts
    |
    | Product Category:
    | T-Shirts
    |
    | Valid SizeGuide categories:
    |
    | T-Shirts  ✅
    | Topwear   ✅
    | Men       ✅
    |--------------------------------------------------------------------------
    */

  const compatibleCategoryIds = new Set(
    [productCategory._id, ...(productCategory.ancestors ?? [])].map(
      objectIdToString,
    ),
  );

  const sizeGuideCategoryId = objectIdToString(sizeGuide.category);

  if (!compatibleCategoryIds.has(sizeGuideCategoryId)) {
    throw new AppError(
      "Product Size Guide is not compatible with the Product Category",
      409,
      {
        errorCode: "PRODUCT_SIZE_GUIDE_CATEGORY_MISMATCH",

        details: {
          productCategoryId: objectIdToString(productCategory._id),

          sizeGuideCategoryId,
        },
      },
    );
  }

  return sizeGuide;
};

/*
|--------------------------------------------------------------------------
| Validate Product Collections
|--------------------------------------------------------------------------
|
| Collections are merchandising relationships.
|
| Rules:
|
| - Every supplied Collection must exist.
| - Every supplied Collection must not be deleted.
| - Inactive Collections are allowed.
|
| An inactive Collection does NOT make the Product inactive.
|--------------------------------------------------------------------------
*/

const validateProductCollections = async (collectionIds, options = {}) => {
  if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
    return [];
  }

  const { session = null } = options;

  /*
    |--------------------------------------------------------------------------
    | Defensive Duplicate Protection
    |--------------------------------------------------------------------------
    |
    | Zod already rejects duplicate IDs.
    | This protects internal Service callers too.
    |--------------------------------------------------------------------------
    */

  const normalizedIds = collectionIds.map(objectIdToString);

  const uniqueIds = [...new Set(normalizedIds)];

  if (uniqueIds.length !== normalizedIds.length) {
    throw new AppError(
      "Product collections cannot contain duplicate Collection IDs",
      400,
      {
        errorCode: "PRODUCT_COLLECTION_DUPLICATE",
      },
    );
  }

  const collections = await findCollectionsByIds(uniqueIds, {
    session,
  });

  const foundIds = new Set(
    collections.map((collection) => objectIdToString(collection._id)),
  );

  const missingIds = uniqueIds.filter(
    (collectionId) => !foundIds.has(collectionId),
  );

  if (missingIds.length > 0) {
    throw createProductCollectionNotFoundError(missingIds);
  }

  return collections;
};

/*
|--------------------------------------------------------------------------
| Validate Product Master-Data Dependencies
|--------------------------------------------------------------------------
*/

const validateProductMasterDataDependencies = async (
  productData,
  options = {},
) => {
  const { session = null } = options;

  /*
    |--------------------------------------------------------------------------
    | Category First
    |--------------------------------------------------------------------------
    |
    | SizeGuide compatibility depends on the resolved
    | Product Category and its ancestor path.
    |--------------------------------------------------------------------------
    */

  const category = await validateProductCategory(
    productData.category,
    productData.status,
    {
      session,
    },
  );

  /*
    |--------------------------------------------------------------------------
    | Other Dependencies
    |--------------------------------------------------------------------------
    */

  await Promise.all([
    validateProductBrand(productData.brand, productData.status, {
      session,
    }),

    validateProductSizeGuide(
      productData.sizeGuide,
      category,
      productData.status,
      {
        session,
      },
    ),

    validateProductCollections(productData.collections ?? [], {
      session,
    }),
  ]);

  return category;
};

/*
|--------------------------------------------------------------------------
| Validate Active Product Requirements
|--------------------------------------------------------------------------
|
| Draft products may be incomplete.
|
| Active products must contain:
|
| - At least one active variant
| - At least one product image
| - Exactly one primary image
|--------------------------------------------------------------------------
*/

const validateActiveProductRequirements = (productData) => {
  if (productData.status !== PRODUCT_STATUSES.ACTIVE) {
    return;
  }

  const activeVariantCount = (productData.variants ?? []).filter((variant) => {
    return variant.isActive !== false;
  }).length;

  if (activeVariantCount === 0) {
    throw new AppError(
      "An active product requires at least one active variant",
      409,
      {
        errorCode: "PRODUCT_ACTIVE_VARIANT_REQUIRED",
      },
    );
  }

  const images = productData.images ?? [];

  if (images.length === 0) {
    throw new AppError("An active product requires at least one image", 409, {
      errorCode: "PRODUCT_IMAGE_REQUIRED",
    });
  }

  const primaryImageCount = images.filter((image) => {
    return image.isPrimary === true;
  }).length;

  if (primaryImageCount !== 1) {
    throw new AppError(
      "An active product requires exactly one primary image",
      409,
      {
        errorCode: "PRODUCT_PRIMARY_IMAGE_REQUIRED",
      },
    );
  }
};

/*
|--------------------------------------------------------------------------
| Create Product
|--------------------------------------------------------------------------
*/

export const createProduct = async (productData, actorUserId) => {
  const resultingStatus = productData.status ?? PRODUCT_STATUSES.DRAFT;

  const normalizedProductData = {
    ...productData,
    status: resultingStatus,
  };

  /*
|--------------------------------------------------------------------------
| Validate Independent Product Rules
|--------------------------------------------------------------------------
*/

  await Promise.all([
    ensureProductSlugIsAvailable(normalizedProductData.slug),

    ensureProductSkusAreAvailable(normalizedProductData.variants),
  ]);

  /*
|--------------------------------------------------------------------------
| Validate Master-Data Dependencies
|--------------------------------------------------------------------------
*/

  await validateProductMasterDataDependencies(normalizedProductData);

  /*
    |--------------------------------------------------------------------------
    | Validate Publishing Requirements
    |--------------------------------------------------------------------------
    */

  validateActiveProductRequirements(normalizedProductData);

  /*
    |--------------------------------------------------------------------------
    | Create Product
    |--------------------------------------------------------------------------
    */

  const product = await createProductDocument({
    ...normalizedProductData,

    publishedAt:
      resultingStatus === PRODUCT_STATUSES.ACTIVE ? new Date() : null,

    createdBy: actorUserId,

    updatedBy: actorUserId,
  });

  return product;
};

/*
|--------------------------------------------------------------------------
| Get Admin Product by ID
|--------------------------------------------------------------------------
|
| Administrators can inspect deleted products as well.
|--------------------------------------------------------------------------
*/

export const getAdminProductById = async (productId) => {
  const product = await findProductById(productId, {
    includeDeleted: true,
  });

  if (!product) {
    throw createProductNotFoundError();
  }

  return product;
};

/*
|--------------------------------------------------------------------------
| Get Admin Products
|--------------------------------------------------------------------------
|
| Supports:
|
| - Pagination
| - Search
| - Category
| - Product status
| - Product flags
| - Stock status
| - Deleted state
| - Sorting
|--------------------------------------------------------------------------
*/

export const getAdminProducts = async (filters) => {
  const result = await listAdminProducts(filters);

  return result;
};

/*
|--------------------------------------------------------------------------
| Get Public Products
|--------------------------------------------------------------------------
|
| Returns only Products that are publicly available.
|--------------------------------------------------------------------------
*/

export const getPublicProducts = async (filters) => {
  return listPublicProducts(filters);
};
/*
|--------------------------------------------------------------------------
| Get Public Product by Slug
|--------------------------------------------------------------------------
|
| Draft, inactive, archived, deleted, unpublished,
| or category-unavailable Products return the same
| not-found response.
|--------------------------------------------------------------------------
*/

export const getPublicProductBySlug = async (slug) => {
  const product = await findPublicProductBySlug(slug);

  if (!product) {
    throw createProductNotFoundError();
  }

  return product;
};

/*
|--------------------------------------------------------------------------
| Update Product
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/products/:productId
|--------------------------------------------------------------------------
*/

export const updateProduct = async (productId, updateData, actorUserId) => {
  /*
    |--------------------------------------------------------------------------
    | Find Existing Product
    |--------------------------------------------------------------------------
    |
    | Deleted Products cannot be updated through the normal update endpoint.
    |--------------------------------------------------------------------------
    */

  const product = await findProductById(productId);

  if (!product) {
    throw createProductNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Build Resulting Product State
    |--------------------------------------------------------------------------
    |
    | PATCH updates only the fields provided by the administrator.
    |
    | Arrays such as variants and images are replaced completely when present.
    |--------------------------------------------------------------------------
    */

  const currentProduct = product.toObject({
    virtuals: false,
  });

  const resultingProductData = {
    ...currentProduct,
    ...updateData,

    status: updateData.status ?? product.status,

    category: updateData.category ?? product.category,

    slug: updateData.slug ?? product.slug,

    variants: updateData.variants ?? currentProduct.variants ?? [],

    images: updateData.images ?? currentProduct.images ?? [],
  };

  /*
    |--------------------------------------------------------------------------
    | Validate Slug
    |--------------------------------------------------------------------------
    */

  await ensureProductSlugIsAvailable(resultingProductData.slug, {
    excludeProductId: product._id,
  });

  /*
    |--------------------------------------------------------------------------
    | Validate Variant SKUs
    |--------------------------------------------------------------------------
    |
    | The current Product is excluded so its existing SKUs do not conflict
    | with itself.
    |--------------------------------------------------------------------------
    */

  await ensureProductSkusAreAvailable(resultingProductData.variants, {
    excludeProductId: product._id,
  });

  /*
|--------------------------------------------------------------------------
| Validate Master-Data Dependencies
|--------------------------------------------------------------------------
*/

  await validateProductMasterDataDependencies(resultingProductData);

  /*
    |--------------------------------------------------------------------------
    | Validate Active Product Requirements
    |--------------------------------------------------------------------------
    */

  validateActiveProductRequirements(resultingProductData);

  /*
    |--------------------------------------------------------------------------
    | Manage Publication Date
    |--------------------------------------------------------------------------
    |
    | Remaining active:
    | Keep the existing publishedAt date.
    |
    | Becoming active:
    | Set publishedAt to the current date.
    |
    | Becoming non-active:
    | Clear publishedAt.
    |--------------------------------------------------------------------------
    */

  let publishedAt = product.publishedAt;

  if (resultingProductData.status === PRODUCT_STATUSES.ACTIVE) {
    if (product.status !== PRODUCT_STATUSES.ACTIVE || !product.publishedAt) {
      publishedAt = new Date();
    }
  } else {
    publishedAt = null;
  }

  /*
    |--------------------------------------------------------------------------
    | Apply Allowed Updates
    |--------------------------------------------------------------------------
    */

  product.set({
    ...updateData,

    publishedAt,

    updatedBy: actorUserId,
  });

  return saveProductDocument(product);
};

/*
|--------------------------------------------------------------------------
| Soft Delete Product
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/products/:productId
|
| The operation is idempotent:
|
| - First delete sets deletion fields.
| - Repeated delete returns the already deleted Product.
|--------------------------------------------------------------------------
*/

export const deleteProduct = async (productId, actorUserId) => {
  const product = await findProductById(productId, {
    includeDeleted: true,
  });

  if (!product) {
    throw createProductNotFoundError();
  }

  /*
   * Product is already deleted.
   *
   * Do not replace the original deletedAt
   * or deletedBy audit information.
   */
  if (product.deletedAt) {
    return product;
  }

  product.set({
    deletedAt: new Date(),

    deletedBy: actorUserId,

    updatedBy: actorUserId,
  });

  return saveProductDocument(product);
};

/*
|--------------------------------------------------------------------------
| Restore Product
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/products/:productId/restore
|
| The operation is idempotent:
|
| - First restore clears deletion fields.
| - Repeated restore returns the active document unchanged.
|--------------------------------------------------------------------------
*/

export const restoreProduct = async (productId, actorUserId) => {
  const product = await findProductById(productId, {
    includeDeleted: true,
  });

  if (!product) {
    throw createProductNotFoundError();
  }

  /*
   * Product is already available.
   */
  if (!product.deletedAt) {
    return product;
  }

  const productData = product.toObject({
    virtuals: false,
  });

  /*
    |--------------------------------------------------------------------------
    | Revalidate Master-Data Dependencies
    |--------------------------------------------------------------------------
    |
    | Any dependency may have changed while
    | the Product was deleted.
    |--------------------------------------------------------------------------
    */

  await validateProductMasterDataDependencies({
    category: product.category,

    brand: product.brand,

    sizeGuide: product.sizeGuide,

    collections: product.collections,

    status: product.status,
  });

  /*
    |--------------------------------------------------------------------------
    | Revalidate Active Product Requirements
    |--------------------------------------------------------------------------
    */

  validateActiveProductRequirements(productData);

  product.set({
    deletedAt: null,

    deletedBy: null,

    updatedBy: actorUserId,
  });

  return saveProductDocument(product);
};

/*
|--------------------------------------------------------------------------
| Adjust Product Variant Stock
|--------------------------------------------------------------------------
|
| stock = stock + quantityDelta
|
| Positive quantity:
| Adds physical units.
|
| Negative quantity:
| Removes physical units.
|--------------------------------------------------------------------------
*/

export const adjustProductVariantInventory = async (
  productId,
  variantId,
  adjustmentData,
  actorUserId,
) => {
  const { quantityDelta, reason, note } = adjustmentData;

  return executeProductInventoryTransaction(async (session) => {
    const product = await adjustVariantStockAtomically({
      productId,
      variantId,
      quantityDelta,
      actorUserId,
      session,
    });

    if (!product) {
      const snapshot = await getProductVariantInventorySnapshot(
        productId,
        variantId,
        session,
      );

      const { stock, reservedStock } = snapshot.variant;

      const resultingStock = stock + quantityDelta;

      if (resultingStock < reservedStock) {
        throw createUnsafeStockAdjustmentError({
          quantityDelta,
          stock,
          reservedStock,
          resultingStock,
        });
      }

      throw createInventoryConflictError();
    }

    await createInventoryLedgerForUpdatedProduct({
      product,
      variantId,

      operation: PRODUCT_INVENTORY_OPERATIONS.ADJUST,

      quantity: Math.abs(quantityDelta),

      stockDelta: quantityDelta,

      reservedStockDelta: 0,

      reason,
      note,
      actorUserId,
      session,
    });

    return product;
  });
};

/*
|--------------------------------------------------------------------------
| Reserve Product Variant Stock
|--------------------------------------------------------------------------
|
| reservedStock = reservedStock + quantity
|
| New reservations require:
|
| - Active Product
| - Active variant
| - Sufficient available stock
|--------------------------------------------------------------------------
*/

export const reserveProductVariantInventory = async (
  productId,
  variantId,
  reservationData,
  actorUserId,
) => {
  const { quantity, referenceId } = reservationData;

  return executeProductInventoryTransaction(async (session) => {
    const product = await reserveVariantStockAtomically({
      productId,
      variantId,
      quantity,
      actorUserId,
      session,
    });

    if (!product) {
      const snapshot = await getProductVariantInventorySnapshot(
        productId,
        variantId,
        session,
      );

      if (snapshot.status !== PRODUCT_STATUSES.ACTIVE) {
        throw createInactiveProductInventoryError();
      }

      if (!snapshot.variant.isActive) {
        throw createInactiveVariantInventoryError();
      }

      const { stock, reservedStock, availableStock } = snapshot.variant;

      if (availableStock < quantity) {
        throw createInsufficientAvailableStockError({
          requestedQuantity: quantity,

          stock,
          reservedStock,
          availableStock,
        });
      }

      throw createInventoryConflictError();
    }

    await createInventoryLedgerForUpdatedProduct({
      product,
      variantId,

      operation: PRODUCT_INVENTORY_OPERATIONS.RESERVE,

      quantity,

      stockDelta: 0,

      reservedStockDelta: quantity,

      referenceId,
      actorUserId,
      session,
    });

    return product;
  });
};

/*
|--------------------------------------------------------------------------
| Release Product Variant Reservation
|--------------------------------------------------------------------------
|
| reservedStock = reservedStock - quantity
|
| Release is allowed even when the Product or variant
| has become inactive.
|--------------------------------------------------------------------------
*/

export const releaseProductVariantInventory = async (
  productId,
  variantId,
  releaseData,
  actorUserId,
) => {
  const { quantity, referenceId } = releaseData;

  return executeProductInventoryTransaction(async (session) => {
    const product = await releaseVariantStockAtomically({
      productId,
      variantId,
      quantity,
      actorUserId,
      session,
    });

    if (!product) {
      const snapshot = await getProductVariantInventorySnapshot(
        productId,
        variantId,
        session,
      );

      const { stock, reservedStock, availableStock } = snapshot.variant;

      if (reservedStock < quantity) {
        throw createInsufficientReservedStockError({
          requestedQuantity: quantity,

          stock,
          reservedStock,
          availableStock,
        });
      }

      throw createInventoryConflictError();
    }

    await createInventoryLedgerForUpdatedProduct({
      product,
      variantId,

      operation: PRODUCT_INVENTORY_OPERATIONS.RELEASE,

      quantity,

      stockDelta: 0,

      reservedStockDelta: -quantity,

      referenceId,
      actorUserId,
      session,
    });

    return product;
  });
};

/*
|--------------------------------------------------------------------------
| Commit Product Variant Reservation
|--------------------------------------------------------------------------
|
| Used after order completion:
|
| stock         = stock - quantity
| reservedStock = reservedStock - quantity
|--------------------------------------------------------------------------
*/

export const commitProductVariantInventory = async (
  productId,
  variantId,
  commitData,
  actorUserId,
) => {
  const { quantity, referenceId } = commitData;

  return executeProductInventoryTransaction(async (session) => {
    const product = await commitVariantStockAtomically({
      productId,
      variantId,
      quantity,
      actorUserId,
      session,
    });

    if (!product) {
      const snapshot = await getProductVariantInventorySnapshot(
        productId,
        variantId,
        session,
      );

      const { stock, reservedStock, availableStock } = snapshot.variant;

      if (reservedStock < quantity) {
        throw createInsufficientReservedStockError({
          requestedQuantity: quantity,

          stock,
          reservedStock,
          availableStock,
        });
      }

      if (stock < quantity) {
        throw createInventoryInconsistentError({
          requestedQuantity: quantity,

          stock,
          reservedStock,
        });
      }

      throw createInventoryConflictError();
    }

    await createInventoryLedgerForUpdatedProduct({
      product,
      variantId,

      operation: PRODUCT_INVENTORY_OPERATIONS.COMMIT,

      quantity,

      stockDelta: -quantity,

      reservedStockDelta: -quantity,

      referenceId,
      actorUserId,
      session,
    });

    return product;
  });
};
