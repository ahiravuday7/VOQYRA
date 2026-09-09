import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

/*
|--------------------------------------------------------------------------
| Primary Product Image
|--------------------------------------------------------------------------
*/

const getPrimaryProductImage = (images = []) => {
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }

  const primaryImage = images.find((image) => image.isPrimary === true);

  const fallbackImage = [...images].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  )[0];

  const image = primaryImage ?? fallbackImage;

  if (!image) {
    return null;
  }

  return {
    id: image._id?.toString() ?? null,

    url: image.url ?? null,

    altText: image.altText ?? "",
  };
};

/*
|--------------------------------------------------------------------------
| Available Variant Stock
|--------------------------------------------------------------------------
|
| Same rule already used by Product:
|
| available = stock - reservedStock
|--------------------------------------------------------------------------
*/

const getVariantAvailableStock = (variant) => {
  if (!variant) {
    return 0;
  }

  const stock = variant.inventory?.stock ?? 0;

  const reservedStock = variant.inventory?.reservedStock ?? 0;

  return Math.max(stock - reservedStock, 0);
};

/*
|--------------------------------------------------------------------------
| Effective Variant Price
|--------------------------------------------------------------------------
|
| Product already follows:
|
| discountPrice ?? sellingPrice
|--------------------------------------------------------------------------
*/

const getVariantEffectivePrice = (variant) => {
  if (!variant) {
    return 0;
  }

  return variant.pricing?.discountPrice ?? variant.pricing?.sellingPrice ?? 0;
};

/*
|--------------------------------------------------------------------------
| Resolve Cart Item Availability
|--------------------------------------------------------------------------
*/

const resolveCartItemAvailability = (product, variant, quantity) => {
  if (!product) {
    return {
      isAvailable: false,

      reason: "PRODUCT_NOT_FOUND",
    };
  }

  if (product.status !== PRODUCT_STATUSES.ACTIVE || product.deletedAt) {
    return {
      isAvailable: false,

      reason: "PRODUCT_UNAVAILABLE",
    };
  }

  if (!variant) {
    return {
      isAvailable: false,

      reason: "VARIANT_NOT_FOUND",
    };
  }

  if (variant.isActive !== true) {
    return {
      isAvailable: false,

      reason: "VARIANT_UNAVAILABLE",
    };
  }

  const availableStock = getVariantAvailableStock(variant);

  if (quantity > availableStock) {
    return {
      isAvailable: false,

      reason: "INSUFFICIENT_STOCK",
    };
  }

  return {
    isAvailable: true,
    reason: null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Cart Item
|--------------------------------------------------------------------------
*/

const toCartItem = (item) => {
  const product = item.product;

  /*
    |--------------------------------------------------------------------------
    | Resolve Variant
    |--------------------------------------------------------------------------
    */

  const variant = product?.variants?.id
    ? product.variants.id(item.variantId)
    : product?.variants?.find?.(
        (candidate) => candidate._id?.toString() === item.variantId?.toString(),
      );

  const quantity = item.quantity ?? 0;

  const availableStock = getVariantAvailableStock(variant);

  const unitPrice = getVariantEffectivePrice(variant);

  const availability = resolveCartItemAvailability(product, variant, quantity);

  /*
    |--------------------------------------------------------------------------
    | Subtotal
    |--------------------------------------------------------------------------
    |
    | We still expose current price, but unavailable items do not contribute
    | to the purchasable Cart subtotal.
    |--------------------------------------------------------------------------
    */

  const subtotal = availability.isAvailable ? unitPrice * quantity : 0;

  return {
    id: item._id?.toString() ?? null,

    product: product
      ? {
          id: product._id?.toString() ?? null,

          name: product.name ?? "",

          slug: product.slug ?? "",

          image: getPrimaryProductImage(product.images),
        }
      : null,

    variant: variant
      ? {
          id: variant._id?.toString() ?? null,

          sku: variant.sku ?? null,

          isActive: variant.isActive === true,
        }
      : {
          id: item.variantId?.toString() ?? null,

          sku: null,

          isActive: false,
        },

    quantity,

    pricing: {
      sellingPrice: variant?.pricing?.sellingPrice ?? null,

      discountPrice: variant?.pricing?.discountPrice ?? null,

      unitPrice,

      currency: variant?.pricing?.currency ?? "INR",

      subtotal,
    },

    inventory: {
      availableStock,
    },

    availability,
  };
};

/*
|--------------------------------------------------------------------------
| Empty Cart
|--------------------------------------------------------------------------
*/

const createEmptyCartResponse = () => {
  return {
    id: null,

    items: [],

    itemCount: 0,

    totalQuantity: 0,

    summary: {
      subtotal: 0,
      currency: "INR",
    },
  };
};

/*
|--------------------------------------------------------------------------
| Map Cart
|--------------------------------------------------------------------------
*/

const toCartResponse = (cart) => {
  if (!cart) {
    return createEmptyCartResponse();
  }

  const items = (cart.items ?? []).map(toCartItem);

  const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);

  const subtotal = items.reduce(
    (total, item) => total + item.pricing.subtotal,
    0,
  );

  const currency =
    items.find((item) => item.pricing.currency)?.pricing.currency ?? "INR";

  return {
    id: cart._id?.toString() ?? null,

    items,

    /*
    |--------------------------------------------------------------------------
    | itemCount
    |--------------------------------------------------------------------------
    |
    | Number of distinct Product + Variant rows.
    |--------------------------------------------------------------------------
    */

    itemCount: items.length,

    /*
    |--------------------------------------------------------------------------
    | totalQuantity
    |--------------------------------------------------------------------------
    |
    | Sum of quantities across Cart items.
    |--------------------------------------------------------------------------
    */

    totalQuantity,

    summary: {
      subtotal,
      currency,
    },
  };
};

export {
  createEmptyCartResponse,
  getVariantAvailableStock,
  getVariantEffectivePrice,
  resolveCartItemAvailability,
  toCartItem,
  toCartResponse,
};
