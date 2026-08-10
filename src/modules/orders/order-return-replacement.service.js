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
  commitVariantStockAtomically,
} from "../products/product.repository.js";

import { findAdminOrderReturnRequestForProcessing } from "./order-return.repository.js";

import { ORDER_RETURN_REPLACEMENT_STATUS } from "./order-return-replacement.model.js";

import {
  createOrderReturnReplacementDocument,
  findOrderReturnReplacementById,
  markOrderReturnReplacementProcessingAtomically,
  saveOrderReturnReplacementDocument,
  markOrderReturnReplacementDeliveredAtomically,
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
| Replacement Processing Errors
|--------------------------------------------------------------------------
*/

const createReturnReplacementProcessingNotFoundError = () => {
  return new AppError("Return replacement was not found", 404, {
    errorCode: "ORDER_RETURN_REPLACEMENT_NOT_FOUND",
  });
};

const createReturnReplacementAlreadyProcessingError = (replacement) => {
  return new AppError("This Return replacement is already processing", 409, {
    errorCode: "ORDER_RETURN_REPLACEMENT_ALREADY_PROCESSING",

    details: {
      status: replacement.status,

      processedAt: replacement.processing?.processedAt ?? null,
    },
  });
};

const createReturnReplacementProcessingStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return replacement cannot begin processing from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_PROCESSING_STATUS_INVALID",

      details: {
        currentStatus,

        requiredStatus: ORDER_RETURN_REPLACEMENT_STATUS.RESERVED,
      },
    },
  );
};

const createReturnReplacementProcessingStateInvalidError = (replacement) => {
  return new AppError(
    "This Return replacement does not contain a valid reserved fulfillment state",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_PROCESSING_STATE_INVALID",

      details: {
        replacementId: String(replacement._id),

        status: replacement.status,
      },
    },
  );
};

const createReturnReplacementProcessingConflictError = () => {
  return new AppError(
    "The Return replacement was modified by another operation. Please refresh and try again.",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_PROCESSING_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Replacement Shipment Errors
|--------------------------------------------------------------------------
*/

const createReturnReplacementShipmentNotFoundError = () => {
  return new AppError("Return replacement was not found", 404, {
    errorCode: "ORDER_RETURN_REPLACEMENT_NOT_FOUND",
  });
};

const createReturnReplacementAlreadyShippedError = (replacement) => {
  return new AppError("This Return replacement has already been shipped", 409, {
    errorCode: "ORDER_RETURN_REPLACEMENT_ALREADY_SHIPPED",

    details: {
      status: replacement.status,

      trackingNumber: replacement.shipment?.trackingNumber ?? null,

      shippedAt: replacement.shipment?.shippedAt ?? null,
    },
  });
};

const createReturnReplacementShipmentStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return replacement cannot be shipped from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_SHIPMENT_STATUS_INVALID",

      details: {
        currentStatus,

        requiredStatus: ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING,
      },
    },
  );
};

const createReturnReplacementShipmentStateInvalidError = (replacement) => {
  return new AppError(
    "This Return replacement does not contain a valid processing state for shipment",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_SHIPMENT_STATE_INVALID",

      details: {
        replacementId: String(replacement._id),

        status: replacement.status,
      },
    },
  );
};

const createReturnReplacementCommitInventoryStateInvalidError = ({
  productId,
  variantId,
  requestedQuantity,
  stock,
  reservedStock,
}) => {
  return new AppError(
    "Replacement inventory cannot be committed from its current state",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_COMMIT_INVENTORY_STATE_INVALID",

      details: {
        productId: String(productId),

        variantId: String(variantId),

        requestedQuantity,

        stock,

        reservedStock,
      },
    },
  );
};

const createReturnReplacementCommitInventoryConflictError = ({
  productId,
  variantId,
}) => {
  return new AppError(
    "Replacement inventory changed while shipment was being processed",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_COMMIT_INVENTORY_CONFLICT",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Replacement Delivery Errors
|--------------------------------------------------------------------------
*/

const createReturnReplacementDeliveryNotFoundError = () => {
  return new AppError("Return replacement was not found", 404, {
    errorCode: "ORDER_RETURN_REPLACEMENT_NOT_FOUND",
  });
};

const createReturnReplacementAlreadyDeliveredError = (replacement) => {
  return new AppError(
    "This Return replacement has already been delivered",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_ALREADY_DELIVERED",

      details: {
        status: replacement.status,

        deliveredAt: replacement.shipment?.deliveredAt ?? null,
      },
    },
  );
};

const createReturnReplacementDeliveryStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return replacement cannot be delivered from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_DELIVERY_STATUS_INVALID",

      details: {
        currentStatus,

        requiredStatus: ORDER_RETURN_REPLACEMENT_STATUS.SHIPPED,
      },
    },
  );
};

const createReturnReplacementDeliveryShipmentStateInvalidError = (
  replacement,
) => {
  return new AppError(
    "This Return replacement does not contain valid shipment information for delivery",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_DELIVERY_SHIPMENT_STATE_INVALID",

      details: {
        replacementId: String(replacement._id),

        status: replacement.status,
      },
    },
  );
};

const createReturnReplacementDeliveryConflictError = () => {
  return new AppError(
    "The Return replacement changed while delivery was being completed",
    409,
    {
      errorCode: "ORDER_RETURN_REPLACEMENT_DELIVERY_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Check Replacement Delivery Shipment State
|--------------------------------------------------------------------------
*/

const replacementHasValidDeliveryShipmentState = (replacement) => {
  const shipment = replacement.shipment;

  if (!shipment) {
    return false;
  }

  const hasReservation = Boolean(replacement.reservation?.reservedAt);

  const hasProcessing = Boolean(replacement.processing?.processedAt);

  const hasShipment = Boolean(
    shipment.carrier &&
    shipment.trackingNumber &&
    shipment.shippedBy &&
    shipment.shippedAt,
  );

  const hasTerminalConflict = Boolean(
    replacement.cancellation?.cancelledAt || replacement.failure?.failedAt,
  );

  return hasReservation && hasProcessing && hasShipment && !hasTerminalConflict;
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Replacement Delivery
|--------------------------------------------------------------------------
*/

const diagnoseFailedReturnReplacementDelivery = async (replacementId) => {
  const replacement = await findOrderReturnReplacementById(replacementId);

  /*
    |--------------------------------------------------------------------------
    | Missing
    |--------------------------------------------------------------------------
    */

  if (!replacement) {
    throw createReturnReplacementDeliveryNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Already Delivered
    |--------------------------------------------------------------------------
    */

  if (
    replacement.status === ORDER_RETURN_REPLACEMENT_STATUS.DELIVERED ||
    replacement.shipment?.deliveredAt
  ) {
    throw createReturnReplacementAlreadyDeliveredError(replacement);
  }

  /*
    |--------------------------------------------------------------------------
    | Wrong Status
    |--------------------------------------------------------------------------
    */

  if (replacement.status !== ORDER_RETURN_REPLACEMENT_STATUS.SHIPPED) {
    throw createReturnReplacementDeliveryStatusInvalidError(replacement.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Shipment Evidence Invalid
    |--------------------------------------------------------------------------
    */

  if (!replacementHasValidDeliveryShipmentState(replacement)) {
    throw createReturnReplacementDeliveryShipmentStateInvalidError(replacement);
  }

  /*
   * State still appears valid, so another concurrent
   * operation likely modified the document.
   */

  throw createReturnReplacementDeliveryConflictError();
};

/*
|--------------------------------------------------------------------------
| Deliver Admin Order Return Replacement
|--------------------------------------------------------------------------
|
| Single-document atomic transition:
|
| shipped -> delivered
|
| IMPORTANT:
|
| Inventory was committed when shipment was created.
| Delivery MUST NOT modify Product inventory.
|--------------------------------------------------------------------------
*/

export const deliverAdminOrderReturnReplacement = async (
  replacementId,
  adminId,
) => {
  if (!replacementId) {
    throw new Error(
      "Replacement ID is required to deliver a Return replacement",
    );
  }

  if (!adminId) {
    throw new Error("Admin ID is required to deliver a Return replacement");
  }

  const deliveredAt = new Date();

  /*
    |--------------------------------------------------------------------------
    | Atomic Delivery Transition
    |--------------------------------------------------------------------------
    */

  const deliveredReplacement =
    await markOrderReturnReplacementDeliveredAtomically({
      replacementId,

      adminId,

      deliveredAt,
    });

  if (deliveredReplacement) {
    return deliveredReplacement;
  }

  /*
    |--------------------------------------------------------------------------
    | Determine Failure Reason
    |--------------------------------------------------------------------------
    */

  return diagnoseFailedReturnReplacementDelivery(replacementId);
};

/*
|--------------------------------------------------------------------------
| Assert Replacement Can Ship
|--------------------------------------------------------------------------
*/

const assertOrderReturnReplacementCanShip = (replacement) => {
  if (replacement.status === ORDER_RETURN_REPLACEMENT_STATUS.SHIPPED) {
    throw createReturnReplacementAlreadyShippedError(replacement);
  }

  if (replacement.status !== ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING) {
    throw createReturnReplacementShipmentStatusInvalidError(replacement.status);
  }

  /*
  |--------------------------------------------------------------------------
  | Reservation Evidence
  |--------------------------------------------------------------------------
  */

  const hasReservationEvidence = Boolean(
    replacement.reservation?.reservedBy && replacement.reservation?.reservedAt,
  );

  /*
  |--------------------------------------------------------------------------
  | Processing Evidence
  |--------------------------------------------------------------------------
  */

  const hasProcessingEvidence = Boolean(
    replacement.processing?.processedBy && replacement.processing?.processedAt,
  );

  /*
  |--------------------------------------------------------------------------
  | Existing Shipment Evidence
  |--------------------------------------------------------------------------
  */

  const hasShipmentEvidence = Boolean(
    replacement.shipment?.carrier ||
    replacement.shipment?.trackingNumber ||
    replacement.shipment?.trackingUrl ||
    replacement.shipment?.shippedBy ||
    replacement.shipment?.shippedAt,
  );

  const hasTerminalConflict = Boolean(
    replacement.cancellation?.cancelledAt || replacement.failure?.failedAt,
  );

  if (
    !hasReservationEvidence ||
    !hasProcessingEvidence ||
    hasShipmentEvidence ||
    hasTerminalConflict
  ) {
    throw createReturnReplacementShipmentStateInvalidError(replacement);
  }
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Replacement Inventory Commit
|--------------------------------------------------------------------------
*/

const diagnoseFailedReturnReplacementCommit = async ({
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

  if (!snapshot || !snapshot.variant) {
    throw createReturnReplacementCommitInventoryStateInvalidError({
      productId,

      variantId,

      requestedQuantity,

      stock: null,

      reservedStock: null,
    });
  }

  const { stock, reservedStock } = snapshot.variant;

  const inventoryIsValid =
    Number.isSafeInteger(stock) &&
    Number.isSafeInteger(reservedStock) &&
    stock >= 0 &&
    reservedStock >= 0 &&
    reservedStock <= stock;

  if (
    !inventoryIsValid ||
    reservedStock < requestedQuantity ||
    stock < requestedQuantity
  ) {
    throw createReturnReplacementCommitInventoryStateInvalidError({
      productId,

      variantId,

      requestedQuantity,

      stock,

      reservedStock,
    });
  }

  /*
   * Snapshot looks valid but the atomic commit failed.
   * Treat this as a concurrent inventory conflict.
   */

  throw createReturnReplacementCommitInventoryConflictError({
    productId,

    variantId,
  });
};

/*
|--------------------------------------------------------------------------
| Create Replacement Commit Ledger
|--------------------------------------------------------------------------
*/

const createReturnReplacementCommitLedgerEntry = async ({
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
   * Commit performs:
   *
   * stock         -= quantity
   * reservedStock -= quantity
   *
   * Therefore reconstruct BEFORE values by adding
   * quantity back to both AFTER values.
   */

  const beforeStock = afterStock + quantity;

  const beforeReservedStock = afterReservedStock + quantity;

  await createProductInventoryLedgerEntry(
    {
      product: updatedProduct._id,

      variantId: updatedVariant._id,

      sku: updatedVariant.sku,

      operation: PRODUCT_INVENTORY_OPERATIONS.COMMIT,

      quantity,

      stockDelta: -quantity,

      reservedStockDelta: -quantity,

      before: buildReplacementInventoryState(beforeStock, beforeReservedStock),

      after: buildReplacementInventoryState(afterStock, afterReservedStock),

      referenceId: replacementNumber,

      actor: actorUserId,
    },

    session,
  );
};

/*
|--------------------------------------------------------------------------
| Commit Replacement Items In Transaction
|--------------------------------------------------------------------------
*/

const commitReturnReplacementItemsInTransaction = async (
  replacement,
  { actorUserId, session },
) => {
  requireActiveReplacementTransaction(session);

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
      | Atomic Commit
      |--------------------------------------------------------------------------
      */

    const updatedProduct = await commitVariantStockAtomically({
      productId: replacementItem.product,

      variantId: replacementItem.variantId,

      quantity,

      actorUserId,

      session,
    });

    if (!updatedProduct) {
      await diagnoseFailedReturnReplacementCommit({
        productId: replacementItem.product,

        variantId: replacementItem.variantId,

        requestedQuantity: quantity,

        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Immutable Inventory Ledger
      |--------------------------------------------------------------------------
      */

    await createReturnReplacementCommitLedgerEntry({
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
| Execute Atomic Replacement Shipment
|--------------------------------------------------------------------------
|
| Transaction:
|
| load replacement
|      ↓
| processing-state validation
|      ↓
| commit every reserved Product variant
|      ↓
| create commit ledger(s)
|      ↓
| replacement -> shipped
|      ↓
| save shipment audit
|      ↓
| commit everything
|--------------------------------------------------------------------------
*/

const executeAtomicOrderReturnReplacementShipment = async ({
  replacementId,
  adminId,
  shipmentData,
}) => {
  const session = await mongoose.startSession();

  try {
    let shippedReplacement;

    await session.withTransaction(
      async () => {
        requireActiveReplacementTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Load Replacement
          |--------------------------------------------------------------------------
          */

        const replacement = await findOrderReturnReplacementById(
          replacementId,
          {
            session,
          },
        );

        if (!replacement) {
          throw createReturnReplacementShipmentNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Validate Current State
          |--------------------------------------------------------------------------
          */

        assertOrderReturnReplacementCanShip(replacement);

        /*
          |--------------------------------------------------------------------------
          | Commit Reserved Replacement Inventory
          |--------------------------------------------------------------------------
          */

        await commitReturnReplacementItemsInTransaction(replacement, {
          actorUserId: adminId,

          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Shipment Audit
          |--------------------------------------------------------------------------
          */

        const shippedAt = new Date();

        replacement.status = ORDER_RETURN_REPLACEMENT_STATUS.SHIPPED;

        replacement.shipment = {
          carrier: shipmentData.carrier,

          trackingNumber: shipmentData.trackingNumber,

          trackingUrl: shipmentData.trackingUrl ?? null,

          note: shipmentData.note ?? null,

          shippedBy: adminId,

          shippedAt,

          deliveredBy: null,

          deliveredAt: null,
        };

        /*
          |--------------------------------------------------------------------------
          | Persist Replacement
          |--------------------------------------------------------------------------
          */

        shippedReplacement = await saveOrderReturnReplacementDocument(
          replacement,
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

    return shippedReplacement;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Ship Admin Order Return Replacement
|--------------------------------------------------------------------------
*/

export const shipAdminOrderReturnReplacement = async (
  replacementId,
  adminId,
  shipmentData,
) => {
  if (!replacementId) {
    throw new Error("Replacement ID is required to ship a Return replacement");
  }

  if (!adminId) {
    throw new Error("Admin ID is required to ship a Return replacement");
  }

  if (!shipmentData) {
    throw new Error("Shipment data is required to ship a Return replacement");
  }

  return executeAtomicOrderReturnReplacementShipment({
    replacementId,

    adminId,

    shipmentData,
  });
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Replacement Processing Transition
|--------------------------------------------------------------------------
*/

const diagnoseFailedReturnReplacementProcessing = async (replacementId) => {
  const replacement = await findOrderReturnReplacementById(replacementId);

  /*
    |--------------------------------------------------------------------------
    | Missing Replacement
    |--------------------------------------------------------------------------
    */

  if (!replacement) {
    throw createReturnReplacementProcessingNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Duplicate Processing
    |--------------------------------------------------------------------------
    */

  if (replacement.status === ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING) {
    throw createReturnReplacementAlreadyProcessingError(replacement);
  }

  /*
    |--------------------------------------------------------------------------
    | Wrong Status
    |--------------------------------------------------------------------------
    */

  if (replacement.status !== ORDER_RETURN_REPLACEMENT_STATUS.RESERVED) {
    throw createReturnReplacementProcessingStatusInvalidError(
      replacement.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Reservation Evidence
    |--------------------------------------------------------------------------
    */

  const hasValidReservation = Boolean(
    replacement.reservation?.reservedBy && replacement.reservation?.reservedAt,
  );

  /*
    |--------------------------------------------------------------------------
    | Impossible / Corrupted State Protection
    |--------------------------------------------------------------------------
    */

  const hasConflictingFulfillmentEvidence = Boolean(
    replacement.processing?.processedAt ||
    replacement.shipment?.shippedAt ||
    replacement.cancellation?.cancelledAt ||
    replacement.failure?.failedAt,
  );

  if (!hasValidReservation || hasConflictingFulfillmentEvidence) {
    throw createReturnReplacementProcessingStateInvalidError(replacement);
  }

  /*
   * If the document still appears valid here,
   * another concurrent operation most likely won
   * the atomic transition.
   */

  throw createReturnReplacementProcessingConflictError();
};

/*
|--------------------------------------------------------------------------
| Process Admin Order Return Replacement
|--------------------------------------------------------------------------
|
| Atomic single-document transition:
|
| reserved -> processing
|
| No Product inventory changes happen here.
|--------------------------------------------------------------------------
*/

export const processAdminOrderReturnReplacement = async (
  replacementId,
  adminId,
  processingData = {},
) => {
  if (!replacementId) {
    throw new Error("Replacement ID is required to begin processing");
  }

  if (!adminId) {
    throw new Error("Admin ID is required to process a Return replacement");
  }

  const processedAt = new Date();

  /*
    |--------------------------------------------------------------------------
    | Atomic State Transition
    |--------------------------------------------------------------------------
    */

  const updatedReplacement =
    await markOrderReturnReplacementProcessingAtomically({
      replacementId,

      adminId,

      note: processingData.note ?? null,

      processedAt,
    });

  if (updatedReplacement) {
    return updatedReplacement;
  }

  /*
    |--------------------------------------------------------------------------
    | Determine Why Atomic Transition Failed
    |--------------------------------------------------------------------------
    */

  return diagnoseFailedReturnReplacementProcessing(replacementId);
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
| Check Whether Return Has Financial Refund Evidence
|--------------------------------------------------------------------------
*/

const orderReturnRequestHasRefundEvidence = (returnRequest) => {
  const refund = returnRequest.refund;

  if (!refund) {
    return false;
  }

  return Boolean(
    refund.refundedAt ||
    refund.refundedBy ||
    refund.referenceId ||
    Number(refund.refundedQuantity ?? 0) > 0 ||
    Number(refund.amount ?? 0) > 0,
  );
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

  if (orderReturnRequestHasRefundEvidence(returnRequest)) {
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
