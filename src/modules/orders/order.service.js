import { randomBytes } from "node:crypto";

import mongoose from "mongoose";

import {
  ORDER_CURRENCIES,
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

import { PRODUCT_INVENTORY_OPERATIONS } from "../../shared/constants/product-inventory.constants.js";

import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { createProductInventoryLedgerEntry } from "../products/product-inventory-ledger.repository.js";

import {
  findProductsForCheckout,
  findProductVariantInventorySnapshot,
  reserveVariantStockAtomically,
} from "../products/product.repository.js";

import {
  createOrderDocument,
  findExistingOrderNumber,
  findCustomerOrderById,
  listCustomerOrders,
} from "./order.repository.js";

/*
|--------------------------------------------------------------------------
| Order Number Configuration
|--------------------------------------------------------------------------
|
| Example:
|
| ORD-20260803-A1B2C3
|--------------------------------------------------------------------------
*/

const ORDER_NUMBER_PREFIX = "ORD";

const ORDER_NUMBER_RANDOM_BYTES = 3;

const MAX_ORDER_NUMBER_GENERATION_ATTEMPTS = 10;

const MAX_ORDER_CREATION_ATTEMPTS = 3;
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
| Customer Order Retrieval Error
|--------------------------------------------------------------------------
*/

const createCustomerOrderNotFoundError = () => {
  return new AppError("Order was not found", 404, {
    errorCode: "ORDER_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Order Creation Errors
|--------------------------------------------------------------------------
*/

const createOrderNumberGenerationError = () => {
  return new AppError("Unable to generate a unique Order number", 503, {
    errorCode: "ORDER_NUMBER_GENERATION_FAILED",
  });
};

const createOrderCreationConflictError = () => {
  return new AppError(
    "The Order could not be created because its reference conflicted. Please try again",
    409,
    {
      errorCode: "ORDER_CREATION_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Generate Order Number Candidate
|--------------------------------------------------------------------------
*/

const generateOrderNumberCandidate = (date = new Date()) => {
  const dateSegment = date.toISOString().slice(0, 10).replace(/-/g, "");

  const randomSegment = randomBytes(ORDER_NUMBER_RANDOM_BYTES)
    .toString("hex")
    .toUpperCase();

  return `${ORDER_NUMBER_PREFIX}-` + `${dateSegment}-` + `${randomSegment}`;
};
/*
|--------------------------------------------------------------------------
| Generate Unique Order Number
|--------------------------------------------------------------------------
|
| A pre-check reduces unnecessary duplicate-key failures.
|
| The unique MongoDB index remains necessary because two
| concurrent transactions could generate the same candidate
| after both pre-checks have completed.
|--------------------------------------------------------------------------
*/

const generateUniqueOrderNumber = async ({ session }) => {
  for (
    let attempt = 1;
    attempt <= MAX_ORDER_NUMBER_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const orderNumber = generateOrderNumberCandidate();

    const existingOrder = await findExistingOrderNumber(orderNumber, {
      session,
    });

    if (!existingOrder) {
      return orderNumber;
    }
  }

  throw createOrderNumberGenerationError();
};

/*
|--------------------------------------------------------------------------
| Detect Duplicate Order Number
|--------------------------------------------------------------------------
*/

const isDuplicateOrderNumberError = (error) => {
  if (error?.code !== 11000) {
    return false;
  }

  return Boolean(
    error?.keyPattern?.orderNumber || error?.keyValue?.orderNumber,
  );
};

/*
|--------------------------------------------------------------------------
| Build Initial Order Status History
|--------------------------------------------------------------------------
*/

const buildInitialOrderStatusHistory = (actorUserId) => {
  return [
    {
      status: ORDER_STATUSES.PENDING,

      note: "Order created",

      changedBy: actorUserId,

      changedAt: new Date(),
    },
  ];
};

/*
|--------------------------------------------------------------------------
| Build New Order Document Data
|--------------------------------------------------------------------------
*/

const buildNewOrderDocumentData = ({
  orderNumber,
  customerId,
  orderData,
  checkoutSnapshot,
  reservedItems,
}) => {
  return {
    orderNumber,

    customer: customerId,

    items: reservedItems,

    shippingAddress: orderData.shippingAddress,

    totals: checkoutSnapshot.totals,

    payment: {
      method: orderData.paymentMethod,

      status: ORDER_PAYMENT_STATUSES.PENDING,

      paidAt: null,

      failedAt: null,

      refundedAt: null,
    },

    status: ORDER_STATUSES.PENDING,

    /*
     * Every item has already been reserved
     * inside the current transaction.
     */
    inventoryStatus: ORDER_INVENTORY_STATUSES.RESERVED,

    statusHistory: buildInitialOrderStatusHistory(customerId),

    customerNote: orderData.customerNote ?? undefined,

    createdBy: customerId,

    updatedBy: customerId,
  };
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Order Creation
|--------------------------------------------------------------------------
|
| This function performs one complete transaction attempt.
|--------------------------------------------------------------------------
*/

const executeAtomicOrderCreation = async (orderData, customerId) => {
  const session = await mongoose.startSession();

  try {
    let createdOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Generate Order Reference
          |--------------------------------------------------------------------------
          */

        const orderNumber = await generateUniqueOrderNumber({
          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Checkout Snapshot
          |--------------------------------------------------------------------------
          |
          | Product names, images, SKUs, variants and prices
          | are loaded from the database.
          |--------------------------------------------------------------------------
          */

        const checkoutSnapshot = await buildOrderCheckoutSnapshot(
          orderData.items,
          {
            session,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Reserve Every Order Item
          |--------------------------------------------------------------------------
          |
          | This also creates one Inventory Ledger entry
          | for every successful reservation.
          |--------------------------------------------------------------------------
          */

        const reservedItems = await reserveOrderItemsInventoryInTransaction(
          checkoutSnapshot.items,
          {
            referenceId: orderNumber,

            actorUserId: customerId,

            session,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Order Data
          |--------------------------------------------------------------------------
          */

        const newOrderData = buildNewOrderDocumentData({
          orderNumber,
          customerId,
          orderData,
          checkoutSnapshot,
          reservedItems,
        });

        /*
          |--------------------------------------------------------------------------
          | Create Order
          |--------------------------------------------------------------------------
          */

        createdOrder = await createOrderDocument(newOrderData, {
          session,
        });
      },

      {
        readConcern: {
          level: "snapshot",
        },

        writeConcern: {
          w: "majority",
        },

        readPreference: "primary",
      },
    );

    return createdOrder;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Create Customer Order
|--------------------------------------------------------------------------
|
| Retries only when the generated Order number collides
| with the unique database index.
|
| MongoDB automatically handles transient transaction
| retries inside session.withTransaction().
|--------------------------------------------------------------------------
*/

export const createCustomerOrder = async (orderData, customerId) => {
  if (!customerId) {
    throw new Error("Customer ID is required to create an Order");
  }

  for (let attempt = 1; attempt <= MAX_ORDER_CREATION_ATTEMPTS; attempt += 1) {
    try {
      return await executeAtomicOrderCreation(orderData, customerId);
    } catch (error) {
      const duplicateOrderNumber = isDuplicateOrderNumberError(error);

      if (duplicateOrderNumber && attempt < MAX_ORDER_CREATION_ATTEMPTS) {
        /*
         * A new transaction and new Order number
         * will be used on the next attempt.
         */
        continue;
      }

      if (duplicateOrderNumber) {
        throw createOrderCreationConflictError();
      }

      throw error;
    }
  }

  throw createOrderCreationConflictError();
};
/*
|--------------------------------------------------------------------------
| Require Active Order Transaction
|--------------------------------------------------------------------------
|
| This function must never create or commit its own transaction.
|
| The future Order creation service will own the transaction
| containing:
|
| - Product inventory reservations
| - Inventory Ledger entries
| - Order document creation
|--------------------------------------------------------------------------
*/

const requireActiveOrderTransaction = (session) => {
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    !session.inTransaction()
  ) {
    throw new Error(
      "Order inventory reservation requires an active MongoDB transaction",
    );
  }
};

/*
|--------------------------------------------------------------------------
| Order Inventory Reservation Conflict
|--------------------------------------------------------------------------
*/

const createOrderInventoryReservationConflictError = (productId, variantId) => {
  return new AppError(
    "Product inventory changed while the Order was being processed",
    409,
    {
      errorCode: "ORDER_INVENTORY_RESERVATION_CONFLICT",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
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

/*
|--------------------------------------------------------------------------
| Build Order Inventory Ledger State
|--------------------------------------------------------------------------
*/

const buildOrderInventoryState = (stock, reservedStock) => {
  return {
    stock,

    reservedStock,

    availableStock: stock - reservedStock,
  };
};

/*
|--------------------------------------------------------------------------
| Find Updated Reserved Variant
|--------------------------------------------------------------------------
*/

const findUpdatedReservedVariant = (product, variantId) => {
  const variant = (product.variants ?? []).find((item) => {
    return String(item._id) === String(variantId);
  });

  if (!variant) {
    throw createOrderVariantUnavailableError(product._id, variantId);
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Order Inventory Reservation
|--------------------------------------------------------------------------
|
| Called only when the atomic reservation returns null.
|--------------------------------------------------------------------------
*/

const diagnoseFailedOrderReservation = async ({
  productId,
  variantId,
  requestedQuantity,
  session,
}) => {
  const snapshot = await findProductVariantInventorySnapshot(
    productId,
    variantId,
    {
      session,
    },
  );

  /*
   * Missing, deleted, or inactive Products are exposed
   * using the same safe checkout error.
   */
  if (
    !snapshot ||
    snapshot.isDeleted ||
    snapshot.status !== PRODUCT_STATUSES.ACTIVE
  ) {
    throw createOrderProductUnavailableError(productId);
  }

  if (!snapshot.variant || !snapshot.variant.isActive) {
    throw createOrderVariantUnavailableError(productId, variantId);
  }

  const { stock, reservedStock, availableStock } = snapshot.variant;

  if (
    !Number.isInteger(stock) ||
    !Number.isInteger(reservedStock) ||
    stock < 0 ||
    reservedStock < 0 ||
    reservedStock > stock
  ) {
    throw createOrderProductInventoryInvalidError({
      productId,
      variantId,
      stock,
      reservedStock,
    });
  }

  if (availableStock < requestedQuantity) {
    throw createOrderInsufficientAvailableStockError({
      productId,
      variantId,

      requestedQuantity,

      stock,
      reservedStock,
      availableStock,
    });
  }

  throw createOrderInventoryReservationConflictError(productId, variantId);
};

/*
|--------------------------------------------------------------------------
| Create Order Reservation Ledger Entry
|--------------------------------------------------------------------------
*/

const createOrderReservationLedgerEntry = async ({
  updatedProduct,
  variantId,
  quantity,
  referenceId,
  actorUserId,
  session,
}) => {
  const updatedVariant = findUpdatedReservedVariant(updatedProduct, variantId);

  const afterStock = updatedVariant.inventory?.stock ?? 0;

  const afterReservedStock = updatedVariant.inventory?.reservedStock ?? 0;

  /*
   * Reservation does not change physical stock.
   *
   * before reserved =
   * after reserved - requested quantity
   */
  const beforeReservedStock = afterReservedStock - quantity;

  await createProductInventoryLedgerEntry(
    {
      product: updatedProduct._id,

      variantId: updatedVariant._id,

      sku: updatedVariant.sku,

      operation: PRODUCT_INVENTORY_OPERATIONS.RESERVE,

      quantity,

      stockDelta: 0,

      reservedStockDelta: quantity,

      before: buildOrderInventoryState(afterStock, beforeReservedStock),

      after: buildOrderInventoryState(afterStock, afterReservedStock),

      referenceId,

      actor: actorUserId,
    },

    session,
  );

  return updatedVariant;
};

/*
|--------------------------------------------------------------------------
| Reserve Order Items Inventory in Transaction
|--------------------------------------------------------------------------
|
| Requirements:
|
| - checkoutItems must contain trusted Order-item snapshots.
| - session must already be inside a transaction.
| - referenceId should be the generated Order number.
|
| The reservations run sequentially.
|
| Do not use Promise.all() for operations using the same
| MongoDB transaction session.
|--------------------------------------------------------------------------
*/

export const reserveOrderItemsInventoryInTransaction = async (
  checkoutItems,
  { referenceId, actorUserId, session },
) => {
  requireActiveOrderTransaction(session);

  if (!referenceId || typeof referenceId !== "string") {
    throw new Error(
      "Order inventory reservation requires an Order reference ID",
    );
  }

  if (!actorUserId) {
    throw new Error("Order inventory reservation requires an actor user ID");
  }

  const reservedOrderItems = [];

  /*
   * Run sequentially so one transaction session does
   * not execute multiple operations in parallel.
   */
  for (const checkoutItem of checkoutItems) {
    const productId = checkoutItem.product;

    const variantId = checkoutItem.variantId;

    const quantity = checkoutItem.quantity;

    /*
      |--------------------------------------------------------------------------
      | Atomic Product Reservation
      |--------------------------------------------------------------------------
      |
      | The condition and mutation occur in one database operation:
      |
      | availableStock >= quantity
      | reservedStock += quantity
      |--------------------------------------------------------------------------
      */

    const updatedProduct = await reserveVariantStockAtomically({
      productId,
      variantId,
      quantity,

      actorUserId,
      session,
    });

    if (!updatedProduct) {
      await diagnoseFailedOrderReservation({
        productId,
        variantId,

        requestedQuantity: quantity,

        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Create Matching Ledger Entry
      |--------------------------------------------------------------------------
      |
      | Uses the same transaction session.
      |--------------------------------------------------------------------------
      */

    await createOrderReservationLedgerEntry({
      updatedProduct,
      variantId,
      quantity,
      referenceId,
      actorUserId,
      session,
    });

    /*
      |--------------------------------------------------------------------------
      | Update Trusted Order-Item Inventory Snapshot
      |--------------------------------------------------------------------------
      */

    reservedOrderItems.push({
      ...checkoutItem,

      inventory: {
        status: ORDER_INVENTORY_STATUSES.RESERVED,

        reservedQuantity: quantity,

        committedQuantity: 0,

        releasedQuantity: 0,
      },
    });
  }

  return reservedOrderItems;
};

/*
|--------------------------------------------------------------------------
| Get Customer Orders
|--------------------------------------------------------------------------
*/

export const getCustomerOrders = async (customerId, filters) => {
  if (!customerId) {
    throw new Error("Customer ID is required to list Orders");
  }

  return listCustomerOrders(customerId, filters);
};

/*
|--------------------------------------------------------------------------
| Get Customer Order by ID
|--------------------------------------------------------------------------
*/

export const getCustomerOrderById = async (orderId, customerId) => {
  if (!customerId) {
    throw new Error("Customer ID is required to retrieve an Order");
  }

  const order = await findCustomerOrderById(orderId, customerId);

  if (!order) {
    /*
     * Return the same error when:
     *
     * - The Order does not exist.
     * - The Order belongs to another customer.
     *
     * This prevents Order ownership disclosure.
     */
    throw createCustomerOrderNotFoundError();
  }

  return order;
};
