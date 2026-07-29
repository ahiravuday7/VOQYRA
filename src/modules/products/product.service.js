import { CATEGORY_STATUSES } from "../../shared/constants/category.constants.js";

import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

import AppError from "../../shared/errors/app-error.js";

import {
  findCategoriesByIds,
  findCategoryById,
} from "../categories/category.repository.js";

import {
  createProductDocument,
  findProductBySlug,
  findProductsByVariantSkus,
} from "./product.repository.js";

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

    validateProductCategory(normalizedProductData.category, resultingStatus),
  ]);

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
