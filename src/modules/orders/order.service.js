import {
  ORDER_CURRENCIES,
  ORDER_INVENTORY_STATUSES,
} from "../../shared/constants/order.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { findProductsForCheckout } from "../products/product.repository.js";

/*
|--------------------------------------------------------------------------
| Order Checkout Errors
|--------------------------------------------------------------------------
*/

const createOrderProductUnavailableError = (productId) => {
  return new AppError("A requested Product is unavailable", 409, {
    errorCode: "ORDER_PRODUCT_UNAVAILABLE",

    details: {
      productId: String(productId),
    },
  });
};

const createOrderVariantUnavailableError = (productId, variantId) => {
  return new AppError("A requested Product variant is unavailable", 409, {
    errorCode: "ORDER_VARIANT_UNAVAILABLE",

    details: {
      productId: String(productId),

      variantId: String(variantId),
    },
  });
};

const createOrderProductImageUnavailableError = (productId) => {
  return new AppError(
    "A requested Product does not have an available checkout image",
    409,
    {
      errorCode: "ORDER_PRODUCT_IMAGE_UNAVAILABLE",

      details: {
        productId: String(productId),
      },
    },
  );
};

const createOrderProductPriceUnavailableError = (productId, variantId) => {
  return new AppError(
    "A requested Product variant does not have valid checkout pricing",
    409,
    {
      errorCode: "ORDER_PRODUCT_PRICE_UNAVAILABLE",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

const createOrderProductInventoryInvalidError = ({
  productId,
  variantId,
  stock,
  reservedStock,
}) => {
  return new AppError(
    "A requested Product variant has inconsistent inventory",
    409,
    {
      errorCode: "ORDER_PRODUCT_INVENTORY_INVALID",

      details: {
        productId: String(productId),

        variantId: String(variantId),

        stock,
        reservedStock,
      },
    },
  );
};

const createOrderInsufficientAvailableStockError = ({
  productId,
  variantId,
  requestedQuantity,
  stock,
  reservedStock,
  availableStock,
}) => {
  return new AppError("Insufficient available stock for an Order item", 409, {
    errorCode: "ORDER_INSUFFICIENT_AVAILABLE_STOCK",

    details: {
      productId: String(productId),

      variantId: String(variantId),

      requestedQuantity,
      stock,
      reservedStock,
      availableStock,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Normalize Checkout Identifier
|--------------------------------------------------------------------------
*/

const normalizeCheckoutIdentifier = (value) => {
  return String(value);
};

/*
|--------------------------------------------------------------------------
| Build Checkout Product Map
|--------------------------------------------------------------------------
|
| Allows requested items to find their Product in O(1)
| without repeatedly scanning the complete Product array.
|--------------------------------------------------------------------------
*/

const buildCheckoutProductMap = (products) => {
  return new Map(
    products.map((product) => {
      return [normalizeCheckoutIdentifier(product._id), product];
    }),
  );
};

/*
|--------------------------------------------------------------------------
| Find Checkout Variant
|--------------------------------------------------------------------------
*/

const findCheckoutVariant = (product, variantId) => {
  const normalizedVariantId = normalizeCheckoutIdentifier(variantId);

  return (product.variants ?? []).find((variant) => {
    return normalizeCheckoutIdentifier(variant._id) === normalizedVariantId;
  });
};

/*
|--------------------------------------------------------------------------
| Select Checkout Product Image
|--------------------------------------------------------------------------
|
| Active Products should have exactly one primary image.
|
| The fallback to the first sorted image is defensive
| protection for older or directly modified documents.
|--------------------------------------------------------------------------
*/

const selectCheckoutProductImage = (product) => {
  const images = [...(product.images ?? [])];

  const primaryImage = images.find((image) => {
    return image.isPrimary === true;
  });

  if (primaryImage) {
    return primaryImage;
  }

  images.sort((firstImage, secondImage) => {
    return (firstImage.sortOrder ?? 0) - (secondImage.sortOrder ?? 0);
  });

  return images[0] ?? null;
};

/*
|--------------------------------------------------------------------------
| Build Trusted Order Item Pricing
|--------------------------------------------------------------------------
|
| Pricing is loaded exclusively from the Product database.
|--------------------------------------------------------------------------
*/

const buildTrustedOrderItemPricing = ({ productId, variant, quantity }) => {
  const pricing = variant.pricing;

  const sellingPrice = pricing?.sellingPrice;

  const discountPrice = pricing?.discountPrice ?? null;

  const currency = pricing?.currency ?? ORDER_CURRENCIES.INR;

  /*
    |--------------------------------------------------------------------------
    | Validate Selling Price
    |--------------------------------------------------------------------------
    */

  if (!Number.isInteger(sellingPrice) || sellingPrice < 0) {
    throw createOrderProductPriceUnavailableError(productId, variant._id);
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Discount Price
    |--------------------------------------------------------------------------
    */

  if (
    discountPrice !== null &&
    (!Number.isInteger(discountPrice) ||
      discountPrice < 0 ||
      discountPrice > sellingPrice)
  ) {
    throw createOrderProductPriceUnavailableError(productId, variant._id);
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Currency
    |--------------------------------------------------------------------------
    */

  if (currency !== ORDER_CURRENCIES.INR) {
    throw createOrderProductPriceUnavailableError(productId, variant._id);
  }

  const unitFinalPrice = discountPrice ?? sellingPrice;

  const discountPerUnit = sellingPrice - unitFinalPrice;

  const lineSubtotal = unitFinalPrice * quantity;

  return {
    currency,

    unitSellingPrice: sellingPrice,

    unitDiscountPrice: discountPrice,

    unitFinalPrice,

    discountPerUnit,

    lineSubtotal,
  };
};

/*
|--------------------------------------------------------------------------
| Validate Checkout Inventory Snapshot
|--------------------------------------------------------------------------
|
| This is an early customer-friendly availability check.
|
| It is not the final overselling protection.
| The actual reservation will still use an atomic
| MongoDB update inside the Order transaction.
|--------------------------------------------------------------------------
*/

const validateCheckoutInventorySnapshot = ({
  productId,
  variant,
  requestedQuantity,
}) => {
  const stock = variant.inventory?.stock ?? 0;

  const reservedStock = variant.inventory?.reservedStock ?? 0;

  if (
    !Number.isInteger(stock) ||
    !Number.isInteger(reservedStock) ||
    stock < 0 ||
    reservedStock < 0 ||
    reservedStock > stock
  ) {
    throw createOrderProductInventoryInvalidError({
      productId,

      variantId: variant._id,

      stock,
      reservedStock,
    });
  }

  const availableStock = stock - reservedStock;

  if (availableStock < requestedQuantity) {
    throw createOrderInsufficientAvailableStockError({
      productId,

      variantId: variant._id,

      requestedQuantity,

      stock,
      reservedStock,
      availableStock,
    });
  }

  return {
    stock,
    reservedStock,
    availableStock,
  };
};

/*
|--------------------------------------------------------------------------
| Build Trusted Order Item Snapshot
|--------------------------------------------------------------------------
*/

const buildTrustedOrderItemSnapshot = ({ requestedItem, product }) => {
  const { productId, variantId, quantity } = requestedItem;

  const variant = findCheckoutVariant(product, variantId);

  /*
    |--------------------------------------------------------------------------
    | Requested Variant Must Exist and Be Active
    |--------------------------------------------------------------------------
    */

  if (!variant || variant.isActive === false) {
    throw createOrderVariantUnavailableError(productId, variantId);
  }

  /*
    |--------------------------------------------------------------------------
    | Verify Early Inventory Snapshot
    |--------------------------------------------------------------------------
    */

  validateCheckoutInventorySnapshot({
    productId,
    variant,

    requestedQuantity: quantity,
  });

  /*
    |--------------------------------------------------------------------------
    | Select Product Image Snapshot
    |--------------------------------------------------------------------------
    */

  const image = selectCheckoutProductImage(product);

  if (!image || !image.url) {
    throw createOrderProductImageUnavailableError(productId);
  }

  /*
    |--------------------------------------------------------------------------
    | Build Trusted Price Snapshot
    |--------------------------------------------------------------------------
    */

  const pricing = buildTrustedOrderItemPricing({
    productId,
    variant,
    quantity,
  });

  return {
    product: product._id,

    variantId: variant._id,

    sku: variant.sku,

    productName: product.name,

    productSlug: product.slug,

    size: variant.size,

    color: {
      name: variant.color?.name,

      code: variant.color?.code ?? undefined,
    },

    image: {
      url: image.url,

      altText: image.altText ?? product.name,
    },

    quantity,

    pricing,

    inventory: {
      status: ORDER_INVENTORY_STATUSES.PENDING,

      reservedQuantity: 0,

      committedQuantity: 0,

      releasedQuantity: 0,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Build Trusted Order Totals
|--------------------------------------------------------------------------
|
| Product-level discounts are already reflected in:
|
| item.pricing.unitFinalPrice
| item.pricing.lineSubtotal
|
| discountAmount is reserved for a future Order-level
| coupon or promotional discount.
|--------------------------------------------------------------------------
*/

const buildTrustedOrderTotals = (orderItems) => {
  const itemsSubtotal = orderItems.reduce((total, item) => {
    return total + item.pricing.lineSubtotal;
  }, 0);

  /*
   * These values are backend controlled.
   *
   * Shipping, tax and coupon calculation can be added
   * later without changing the customer request format.
   */
  const discountAmount = 0;

  const shippingAmount = 0;

  const taxAmount = 0;

  const grandTotal =
    itemsSubtotal - discountAmount + shippingAmount + taxAmount;

  return {
    currency: ORDER_CURRENCIES.INR,

    itemsSubtotal,

    discountAmount,

    shippingAmount,

    taxAmount,

    grandTotal,
  };
};

/*
|--------------------------------------------------------------------------
| Build Order Checkout Snapshot
|--------------------------------------------------------------------------
|
| Input:
| Validated customer-requested items.
|
| Output:
| Trusted Order items and totals generated from database data.
|--------------------------------------------------------------------------
*/

export const buildOrderCheckoutSnapshot = async (
  requestedItems,
  { session = null } = {},
) => {
  const requestedProductIds = requestedItems.map((item) => {
    return item.productId;
  });

  /*
    |--------------------------------------------------------------------------
    | Load All Requested Products in One Query
    |--------------------------------------------------------------------------
    */

  const checkoutProducts = await findProductsForCheckout(requestedProductIds, {
    session,
  });

  const checkoutProductMap = buildCheckoutProductMap(checkoutProducts);

  /*
    |--------------------------------------------------------------------------
    | Preserve Customer Item Order
    |--------------------------------------------------------------------------
    |
    | The database query may return Products in any order.
    | Mapping from requestedItems preserves request order.
    |--------------------------------------------------------------------------
    */

  const orderItems = requestedItems.map((requestedItem) => {
    const product = checkoutProductMap.get(
      normalizeCheckoutIdentifier(requestedItem.productId),
    );

    if (!product) {
      throw createOrderProductUnavailableError(requestedItem.productId);
    }

    return buildTrustedOrderItemSnapshot({
      requestedItem,
      product,
    });
  });

  const totals = buildTrustedOrderTotals(orderItems);

  return {
    items: orderItems,

    totals,
  };
};
