import mongoose from "mongoose";
import {
  ORDER_RETURN_ITEM_INSPECTION_STATUSES,
  ORDER_RETURN_STATUSES,
} from "../../shared/constants/order.constants.js";

import AppError from "../../shared/errors/app-error.js";
import { PRODUCT_INVENTORY_OPERATIONS } from "../../shared/constants/product-inventory.constants.js";

import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";
import { createProductInventoryLedgerEntry } from "../products/product-inventory-ledger.repository.js";

import {
  findProductVariantInventorySnapshot,
  reserveVariantStockAtomically,
} from "../products/product.repository.js";

import { findAdminOrderReturnRequestForProcessing } from "./order-return.repository.js";

import { ORDER_RETURN_REPLACEMENT_STATUS } from "./order-return-replacement.model.js";

import {
  createOrderReturnReplacementDocument,
  saveOrderReturnReplacementDocument,
} from "./order-return-replacement.repository.js";

/*
|--------------------------------------------------------------------------
| Replacement Resolution
|--------------------------------------------------------------------------
|
| Keep this local for now.
|
| We are not changing the existing shared Return constants merely for
| this Part. The existing Return system already stores the resolution
| value "replacement".
|--------------------------------------------------------------------------
*/

const REPLACEMENT_RESOLUTION = "replacement";

/*
|--------------------------------------------------------------------------
| Replacement Errors
|--------------------------------------------------------------------------
*/

const createReturnReplacementStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be replaced from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_STATUS_INVALID",

      details: {
        currentStatus,

        requiredStatus: ORDER_RETURN_STATUSES.COMPLETED,
      },
    },
  );
};

const createReturnReplacementResolutionInvalidError = (requestedResolution) => {
  return new AppError(
    "This Return Request was not created for replacement",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_RESOLUTION_INVALID",

      details: {
        requestedResolution,

        requiredResolution: REPLACEMENT_RESOLUTION,
      },
    },
  );
};

const createReturnReplacementRefundConflictError = () => {
  return new AppError(
    "A refunded Return Request cannot also be replaced",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_REFUND_CONFLICT",
    },
  );
};

const createReturnReplacementInspectionInvalidError = (orderItemId) => {
  return new AppError(
    "A Return item does not contain valid completed inspection information",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_INSPECTION_INVALID",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

const createReturnReplacementQuantityInvalidError = ({
  orderItemId,
  returnedQuantity,
  resellableQuantity,
  damagedQuantity,
  rejectedQuantity,
}) => {
  return new AppError(
    "A Return item contains invalid replacement quantities",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_QUANTITY_INVALID",

      details: {
        orderItemId: String(orderItemId),

        returnedQuantity,

        resellableQuantity,

        damagedQuantity,

        rejectedQuantity,
      },
    },
  );
};

const createReturnReplacementNothingEligibleError = () => {
  return new AppError(
    "This Return Request does not contain any quantity eligible for replacement",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_NOTHING_ELIGIBLE",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Replacement Persistence Errors
|--------------------------------------------------------------------------
*/

const createReturnReplacementNotFoundError = () => {
  return new AppError("Return Request was not found", 404, {
    errorCode: "ORDER_RETURN_REQUEST_NOT_FOUND",
  });
};

const createReturnReplacementAlreadyExistsError = () => {
  return new AppError(
    "A replacement already exists for this Return Request",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_ALREADY_EXISTS",
    },
  );
};

const createReturnReplacementProductUnavailableError = (productId) => {
  return new AppError(
    "A Product required for this replacement is unavailable",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_PRODUCT_UNAVAILABLE",

      details: {
        productId: String(productId),
      },
    },
  );
};

const createReturnReplacementVariantUnavailableError = ({
  productId,
  variantId,
}) => {
  return new AppError(
    "A Product variant required for this replacement is unavailable",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_VARIANT_UNAVAILABLE",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

const createReturnReplacementInventoryInvalidError = ({
  productId,
  variantId,
  stock,
  reservedStock,
}) => {
  return new AppError("Replacement inventory is in an invalid state", 409, {
    errorCode: "ORDER_RETURN_REPLACEMENT_INVENTORY_INVALID",

    details: {
      productId: String(productId),

      variantId: String(variantId),

      stock,

      reservedStock,
    },
  });
};

const createReturnReplacementInsufficientStockError = ({
  productId,
  variantId,
  requestedQuantity,
  stock,
  reservedStock,
  availableStock,
}) => {
  return new AppError("Insufficient available stock for the replacement", 409, {
    errorCode: "ORDER_RETURN_REPLACEMENT_INSUFFICIENT_STOCK",

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

const createReturnReplacementInventoryConflictError = ({
  productId,
  variantId,
}) => {
  return new AppError(
    "Replacement inventory changed while the request was being processed",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_INVENTORY_CONFLICT",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

const createReturnReplacementCreationConflictError = () => {
  return new AppError(
    "The replacement could not be created because of a concurrent conflict. Please try again.",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_CREATION_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Require Active Replacement Transaction
|--------------------------------------------------------------------------
*/

const requireActiveReplacementTransaction = (session) => {
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    !session.inTransaction()
  ) {
    throw new Error(
      "Return replacement inventory reservation requires an active MongoDB transaction",
    );
  }
};

/*
|--------------------------------------------------------------------------
| Build Replacement Inventory State
|--------------------------------------------------------------------------
*/

const buildReplacementInventoryState = (stock, reservedStock) => {
  return {
    stock,

    reservedStock,

    availableStock: stock - reservedStock,
  };
};

/*
|--------------------------------------------------------------------------
| Find Updated Replacement Variant
|--------------------------------------------------------------------------
*/

const findUpdatedReplacementVariant = (product, variantId) => {
  const variant = (product.variants ?? []).find((candidate) => {
    return String(candidate._id) === String(variantId);
  });

  if (!variant) {
    throw createReturnReplacementVariantUnavailableError({
      productId: product._id,

      variantId,
    });
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Replacement Reservation
|--------------------------------------------------------------------------
*/

const diagnoseFailedReturnReplacementReservation = async ({
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
  |--------------------------------------------------------------------------
  | Product Availability
  |--------------------------------------------------------------------------
  */

  if (
    !snapshot ||
    snapshot.isDeleted ||
    snapshot.status !== PRODUCT_STATUSES.ACTIVE
  ) {
    throw createReturnReplacementProductUnavailableError(productId);
  }

  /*
  |--------------------------------------------------------------------------
  | Variant Availability
  |--------------------------------------------------------------------------
  */

  if (!snapshot.variant || !snapshot.variant.isActive) {
    throw createReturnReplacementVariantUnavailableError({
      productId,

      variantId,
    });
  }

  const { stock, reservedStock, availableStock } = snapshot.variant;

  /*
  |--------------------------------------------------------------------------
  | Inventory Integrity
  |--------------------------------------------------------------------------
  */

  if (
    !Number.isSafeInteger(stock) ||
    !Number.isSafeInteger(reservedStock) ||
    stock < 0 ||
    reservedStock < 0 ||
    reservedStock > stock
  ) {
    throw createReturnReplacementInventoryInvalidError({
      productId,

      variantId,

      stock,

      reservedStock,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Available Stock
  |--------------------------------------------------------------------------
  */

  if (availableStock < requestedQuantity) {
    throw createReturnReplacementInsufficientStockError({
      productId,

      variantId,

      requestedQuantity,

      stock,

      reservedStock,

      availableStock,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Concurrent Inventory Change
  |--------------------------------------------------------------------------
  |
  | Inventory appears valid and sufficient in the diagnostic snapshot,
  | therefore the original atomic update most likely lost a concurrency
  | race.
  |--------------------------------------------------------------------------
  */

  throw createReturnReplacementInventoryConflictError({
    productId,

    variantId,
  });
};

/*
|--------------------------------------------------------------------------
| Create Replacement Reservation Ledger Entry
|--------------------------------------------------------------------------
*/

const createReturnReplacementReservationLedgerEntry = async ({
  updatedProduct,
  variantId,
  quantity,
  replacementNumber,
  actorUserId,
  session,
}) => {
  const updatedVariant = findUpdatedReplacementVariant(
    updatedProduct,
    variantId,
  );

  const afterStock = updatedVariant.inventory?.stock ?? 0;

  const afterReservedStock = updatedVariant.inventory?.reservedStock ?? 0;

  /*
   * Reservation changes only reservedStock.
   *
   * beforeReservedStock =
   * afterReservedStock - reserved quantity
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

      before: buildReplacementInventoryState(afterStock, beforeReservedStock),

      after: buildReplacementInventoryState(afterStock, afterReservedStock),

      /*
       * Replacement-specific reference.
       *
       * Example:
       * RPL-20260810-ABCDEF123456
       */
      referenceId: replacementNumber,

      actor: actorUserId,
    },

    session,
  );

  return updatedVariant;
};

/*
|--------------------------------------------------------------------------
| Reserve Replacement Items Inventory
|--------------------------------------------------------------------------
|
| All replacement Product reservations happen sequentially using the
| same MongoDB transaction session.
|--------------------------------------------------------------------------
*/

const reserveReturnReplacementItemsInTransaction = async (
  replacement,
  { actorUserId, session },
) => {
  requireActiveReplacementTransaction(session);

  if (!replacement?.replacementNumber) {
    throw new Error(
      "Replacement number is required before inventory reservation",
    );
  }

  if (!actorUserId) {
    throw new Error(
      "Replacement inventory reservation requires an actor user ID",
    );
  }

  for (const replacementItem of replacement.items ?? []) {
    const quantity = Number(replacementItem.replacementQuantity);

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw createReturnReplacementInventoryInvalidError({
        productId: replacementItem.product,

        variantId: replacementItem.variantId,

        stock: null,

        reservedStock: null,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Atomic Product Reservation
    |--------------------------------------------------------------------------
    */

    const updatedProduct = await reserveVariantStockAtomically({
      productId: replacementItem.product,

      variantId: replacementItem.variantId,

      quantity,

      actorUserId,

      session,
    });

    /*
    |--------------------------------------------------------------------------
    | Diagnose Failed Reservation
    |--------------------------------------------------------------------------
    */

    if (!updatedProduct) {
      await diagnoseFailedReturnReplacementReservation({
        productId: replacementItem.product,

        variantId: replacementItem.variantId,

        requestedQuantity: quantity,

        session,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Immutable Inventory Movement History
    |--------------------------------------------------------------------------
    */

    await createReturnReplacementReservationLedgerEntry({
      updatedProduct,

      variantId: replacementItem.variantId,

      quantity,

      replacementNumber: replacement.replacementNumber,

      actorUserId,

      session,
    });
  }
};

/*
|--------------------------------------------------------------------------
| MongoDB Duplicate Key
|--------------------------------------------------------------------------
*/

const isMongoDuplicateKeyError = (error) => {
  return error?.code === 11000;
};

const isReturnReplacementDuplicateError = (error) => {
  if (!isMongoDuplicateKeyError(error)) {
    return false;
  }

  return Boolean(
    error?.keyPattern?.returnRequest || error?.keyPattern?.returnRequestNumber,
  );
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Return Replacement Creation
|--------------------------------------------------------------------------
|
| Transaction:
|
| Load completed Return
|        ↓
| Build trusted replacement plan
|        ↓
| Create pending Replacement
|        ↓
| Reserve every replacement Product variant
|        ↓
| Write inventory ledgers
|        ↓
| Mark Replacement reserved
|        ↓
| Commit everything together
|--------------------------------------------------------------------------
*/

const executeAtomicOrderReturnReplacementCreation = async ({
  returnRequestId,
  adminId,
}) => {
  const session = await mongoose.startSession();

  try {
    let createdReplacement;

    await session.withTransaction(
      async () => {
        requireActiveReplacementTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Load Return Request
          |--------------------------------------------------------------------------
          */

        const returnRequest = await findAdminOrderReturnRequestForProcessing(
          returnRequestId,
          {
            session,
          },
        );

        if (!returnRequest) {
          throw createReturnReplacementNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Trusted Replacement Plan
          |--------------------------------------------------------------------------
          */

        const replacementPlan =
          buildTrustedOrderReturnReplacementPlan(returnRequest);

        /*
          |--------------------------------------------------------------------------
          | Create Replacement First
          |--------------------------------------------------------------------------
          |
          | Creating this first claims the unique Return Request replacement
          | relationship before inventory reservations are performed.
          |
          | The document is still invisible outside this transaction.
          |--------------------------------------------------------------------------
          */

        createdReplacement = await createOrderReturnReplacementDocument(
          {
            ...replacementPlan,

            status: ORDER_RETURN_REPLACEMENT_STATUS.PENDING,
          },
          {
            session,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Reserve Inventory
          |--------------------------------------------------------------------------
          */

        await reserveReturnReplacementItemsInTransaction(createdReplacement, {
          actorUserId: adminId,

          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Mark Replacement Reserved
          |--------------------------------------------------------------------------
          */

        const reservedAt = new Date();

        createdReplacement.status = ORDER_RETURN_REPLACEMENT_STATUS.RESERVED;

        createdReplacement.reservation = {
          reservedBy: adminId,

          reservedAt,
        };

        /*
          |--------------------------------------------------------------------------
          | Persist Reserved State
          |--------------------------------------------------------------------------
          */

        createdReplacement = await saveOrderReturnReplacementDocument(
          createdReplacement,
          {
            session,
          },
        );
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

    return createdReplacement;
  } catch (error) {
    /*
      |--------------------------------------------------------------------------
      | Existing Replacement
      |--------------------------------------------------------------------------
      */

    if (isReturnReplacementDuplicateError(error)) {
      throw createReturnReplacementAlreadyExistsError();
    }

    /*
      |--------------------------------------------------------------------------
      | Extremely Rare Replacement-Number Collision
      |--------------------------------------------------------------------------
      */

    if (isMongoDuplicateKeyError(error)) {
      throw createReturnReplacementCreationConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Create Admin Order Return Replacement
|--------------------------------------------------------------------------
*/

export const createAdminOrderReturnReplacement = async (
  returnRequestId,
  adminId,
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to create a Return replacement");
  }

  if (!returnRequestId) {
    throw new Error("Return Request ID is required to create a replacement");
  }

  return executeAtomicOrderReturnReplacementCreation({
    returnRequestId,

    adminId,
  });
};

/*
|--------------------------------------------------------------------------
| Assert Replacement Return Eligibility
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const assertOrderReturnCanCreateReplacement = (returnRequest) => {
  if (!returnRequest) {
    throw new TypeError(
      "Return Request is required to build a replacement plan",
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Return Must Be Completed
  |--------------------------------------------------------------------------
  */

  if (returnRequest.status !== ORDER_RETURN_STATUSES.COMPLETED) {
    throw createReturnReplacementStatusInvalidError(returnRequest.status);
  }

  /*
  |--------------------------------------------------------------------------
  | Resolution Must Be Replacement
  |--------------------------------------------------------------------------
  */

  if (returnRequest.requestedResolution !== REPLACEMENT_RESOLUTION) {
    throw createReturnReplacementResolutionInvalidError(
      returnRequest.requestedResolution,
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Refund And Replacement Are Mutually Exclusive
  |--------------------------------------------------------------------------
  */

  if (returnRequest.refund) {
    throw createReturnReplacementRefundConflictError();
  }
};

/*
|--------------------------------------------------------------------------
| Build Trusted Replacement Item
|--------------------------------------------------------------------------
|
| Replacement rule:
|
| replacementQuantity =
|   resellableQuantity + damagedQuantity
|
| rejectedQuantity is NOT replacement eligible.
|--------------------------------------------------------------------------
*/

const buildTrustedReplacementItem = (returnItem) => {
  const inspection = returnItem.inspection;

  /*
  |--------------------------------------------------------------------------
  | Inspection Must Be Complete
  |--------------------------------------------------------------------------
  */

  if (
    !inspection ||
    inspection.status !== ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED
  ) {
    throw createReturnReplacementInspectionInvalidError(returnItem.orderItemId);
  }

  const returnedQuantity = Number(returnItem.quantity);

  const resellableQuantity = Number(inspection.resellableQuantity);

  const damagedQuantity = Number(inspection.damagedQuantity);

  const rejectedQuantity = Number(inspection.rejectedQuantity);

  /*
  |--------------------------------------------------------------------------
  | Validate Trusted Quantities
  |--------------------------------------------------------------------------
  */

  const quantitiesAreValid =
    Number.isSafeInteger(returnedQuantity) &&
    returnedQuantity > 0 &&
    Number.isSafeInteger(resellableQuantity) &&
    resellableQuantity >= 0 &&
    Number.isSafeInteger(damagedQuantity) &&
    damagedQuantity >= 0 &&
    Number.isSafeInteger(rejectedQuantity) &&
    rejectedQuantity >= 0;

  const inspectedQuantity =
    resellableQuantity + damagedQuantity + rejectedQuantity;

  if (!quantitiesAreValid || inspectedQuantity !== returnedQuantity) {
    throw createReturnReplacementQuantityInvalidError({
      orderItemId: returnItem.orderItemId,

      returnedQuantity,

      resellableQuantity,

      damagedQuantity,

      rejectedQuantity,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Trusted Replacement Quantity
  |--------------------------------------------------------------------------
  */

  const replacementQuantity = resellableQuantity + damagedQuantity;

  /*
   * A completely rejected Return item does not
   * create a replacement fulfillment item.
   */
  if (replacementQuantity === 0) {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | Build Trusted Snapshot
  |--------------------------------------------------------------------------
  |
  | These fields were already copied from the trusted
  | original Order item when the Return Request was created.
  |--------------------------------------------------------------------------
  */

  return {
    returnItemId: returnItem._id,

    orderItemId: returnItem.orderItemId,

    product: returnItem.product,

    variantId: returnItem.variantId,

    productName: returnItem.productName,

    sku: returnItem.sku,

    size: returnItem.size ?? null,

    color: {
      name: returnItem.color?.name ?? null,

      code: returnItem.color?.code ?? null,
    },

    returnedQuantity,

    replacementQuantity,
  };
};

/*
|--------------------------------------------------------------------------
| Build Trusted Return Replacement Plan
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| This function performs NO database writes.
| It does NOT reserve Product inventory.
| It only validates the completed Return and produces trusted data that
| Part 147+ can persist transactionally.
|--------------------------------------------------------------------------
*/

export const buildTrustedOrderReturnReplacementPlan = (returnRequest) => {
  assertOrderReturnCanCreateReplacement(returnRequest);

  const replacementItems = [];

  /*
   * Keep processing sequential and explicit.
   */
  for (const returnItem of returnRequest.items ?? []) {
    const replacementItem = buildTrustedReplacementItem(returnItem);

    if (replacementItem) {
      replacementItems.push(replacementItem);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | At Least One Accepted Quantity Is Required
  |--------------------------------------------------------------------------
  */

  if (replacementItems.length === 0) {
    throw createReturnReplacementNothingEligibleError();
  }

  const totalReplacementQuantity = replacementItems.reduce(
    (total, item) => total + item.replacementQuantity,
    0,
  );

  /*
  |--------------------------------------------------------------------------
  | Trusted Replacement Plan
  |--------------------------------------------------------------------------
  */

  return {
    returnRequest: returnRequest._id,

    returnRequestNumber: returnRequest.returnRequestNumber,

    order: returnRequest.order,

    orderNumber: returnRequest.orderNumber,

    customer: returnRequest.customer,

    items: replacementItems,

    totalReplacementQuantity,
  };
};
