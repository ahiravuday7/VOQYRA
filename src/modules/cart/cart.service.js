import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { findProductById } from "../products/product.repository.js";

import { CART_LIMITS } from "./cart.constants.js";

import {
  findOrCreateCartByUserId,
  saveCartDocument,
} from "./cart.repository.js";

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

const createCartQuantityInvalidError = () => {
  return new AppError("Cart item quantity is invalid", 400, {
    errorCode: "CART_QUANTITY_INVALID",
  });
};

const createCartInsufficientStockError = (
  requestedQuantity,
  availableStock,
) => {
  return new AppError("Requested quantity exceeds available stock", 409, {
    errorCode: "CART_INSUFFICIENT_STOCK",

    details: {
      requestedQuantity,
      availableStock,
    },
  });
};

const createCartItemLimitExceededError = () => {
  return new AppError("Cart item limit has been reached", 409, {
    errorCode: "CART_ITEM_LIMIT_EXCEEDED",

    details: {
      maxItems: CART_LIMITS.MAX_ITEMS,
    },
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
| Validate Cart Quantity Against Stock
|--------------------------------------------------------------------------
|
| Cart does NOT reserve inventory.
|
| We only check the current available quantity:
|
| stock - reservedStock
|--------------------------------------------------------------------------
*/

const validateCartQuantityAgainstStock = (variant, quantity) => {
  /*
    |--------------------------------------------------------------------------
    | Defensive Quantity Validation
    |--------------------------------------------------------------------------
    |
    | Zod already validates API requests, but the service may later be reused
    | internally, so business-layer validation remains useful.
    |--------------------------------------------------------------------------
    */

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > CART_LIMITS.MAX_QUANTITY_PER_ITEM
  ) {
    throw createCartQuantityInvalidError();
  }

  /*
    |--------------------------------------------------------------------------
    | Available Stock
    |--------------------------------------------------------------------------
    |
    | Equivalent to Product's existing availableStock virtual:
    |
    | stock - reservedStock
    |--------------------------------------------------------------------------
    */

  const stock = variant.inventory?.stock ?? 0;

  const reservedStock = variant.inventory?.reservedStock ?? 0;

  const availableStock = Math.max(stock - reservedStock, 0);

  if (quantity > availableStock) {
    throw createCartInsufficientStockError(quantity, availableStock);
  }

  return {
    quantity,
    availableStock,
  };
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

/*
|--------------------------------------------------------------------------
| Add Cart Item
|--------------------------------------------------------------------------
|
| Same Product + same Variant:
|   increase quantity.
|
| Different Product/Variant:
|   create another Cart item.
|
| Important:
|   Cart does NOT reserve Product inventory.
|--------------------------------------------------------------------------
*/

const addCartItem = async (userId, { productId, variantId, quantity }) => {
  /*
    |--------------------------------------------------------------------------
    | Resolve Product + Variant
    |--------------------------------------------------------------------------
    */

  const { product, variant } = await resolveCartProductVariant(
    productId,
    variantId,
  );

  /*
    |--------------------------------------------------------------------------
    | Find/Create User Cart
    |--------------------------------------------------------------------------
    */

  const cart = await findOrCreateCartByUserId(userId);

  /*
    |--------------------------------------------------------------------------
    | Existing Cart Item
    |--------------------------------------------------------------------------
    |
    | Product + Variant combination identifies the same purchasable item.
    |--------------------------------------------------------------------------
    */

  const existingItem = cart.items.find(
    (item) =>
      item.product.toString() === product._id.toString() &&
      item.variantId.toString() === variant._id.toString(),
  );

  if (existingItem) {
    const nextQuantity = existingItem.quantity + quantity;

    /*
      |--------------------------------------------------------------------------
      | Validate FINAL Quantity
      |--------------------------------------------------------------------------
      |
      | Example:
      |
      | Existing Cart quantity = 3
      | New request            = 2
      |
      | Validate 5, not only 2.
      |--------------------------------------------------------------------------
      */

    validateCartQuantityAgainstStock(variant, nextQuantity);

    existingItem.quantity = nextQuantity;

    return saveCartDocument(cart);
  }

  /*
    |--------------------------------------------------------------------------
    | Distinct Item Limit
    |--------------------------------------------------------------------------
    */

  if (cart.items.length >= CART_LIMITS.MAX_ITEMS) {
    throw createCartItemLimitExceededError();
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Requested Quantity
    |--------------------------------------------------------------------------
    */

  validateCartQuantityAgainstStock(variant, quantity);

  /*
    |--------------------------------------------------------------------------
    | Add New Item
    |--------------------------------------------------------------------------
    */

  cart.items.push({
    product: product._id,

    variantId: variant._id,

    quantity,
  });

  return saveCartDocument(cart);
};

export {
  findAndValidateCartVariant,
  resolveCartProductVariant,
  validateCartProduct,
  validateCartQuantityAgainstStock,
  addCartItem,
};
