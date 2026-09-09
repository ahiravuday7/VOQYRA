import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { findProductById } from "../products/product.repository.js";

/*
|--------------------------------------------------------------------------
| Cart Errors
|--------------------------------------------------------------------------
*/

const createCartProductNotFoundError = () => {
  return new AppError("Product was not found", 404, {
    errorCode: "CART_PRODUCT_NOT_FOUND",
  });
};

const createCartProductUnavailableError = () => {
  return new AppError("Product is not available for purchase", 409, {
    errorCode: "CART_PRODUCT_UNAVAILABLE",
  });
};

const createCartVariantNotFoundError = () => {
  return new AppError("Product variant was not found", 404, {
    errorCode: "CART_VARIANT_NOT_FOUND",
  });
};

const createCartVariantUnavailableError = () => {
  return new AppError("Product variant is not available for purchase", 409, {
    errorCode: "CART_VARIANT_UNAVAILABLE",
  });
};

/*
|--------------------------------------------------------------------------
| Validate Cart Product
|--------------------------------------------------------------------------
|
| Cart can only accept:
|
| active Product
| +
| non-deleted Product
|--------------------------------------------------------------------------
*/

const validateCartProduct = (product) => {
  if (!product) {
    throw createCartProductNotFoundError();
  }

  if (product.status !== PRODUCT_STATUSES.ACTIVE || product.deletedAt) {
    throw createCartProductUnavailableError();
  }

  return product;
};

/*
|--------------------------------------------------------------------------
| Find + Validate Variant
|--------------------------------------------------------------------------
|
| variantId references an embedded Product variant.
|--------------------------------------------------------------------------
*/

const findAndValidateCartVariant = (product, variantId) => {
  const variant = product.variants.id(variantId);

  if (!variant) {
    throw createCartVariantNotFoundError();
  }

  if (variant.isActive !== true) {
    throw createCartVariantUnavailableError();
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Resolve Cart Product + Variant
|--------------------------------------------------------------------------
|
| Shared foundation for:
|
| Add Cart Item
| Update Cart Item
| Cart Refresh
|
|--------------------------------------------------------------------------
*/

const resolveCartProductVariant = async (productId, variantId) => {
  const product = await findProductById(productId);

  validateCartProduct(product);

  const variant = findAndValidateCartVariant(product, variantId);

  return {
    product,
    variant,
  };
};

export {
  findAndValidateCartVariant,
  resolveCartProductVariant,
  validateCartProduct,
};
