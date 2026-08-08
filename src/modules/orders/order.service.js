import { randomBytes } from "node:crypto";

import mongoose from "mongoose";

import {
  ORDER_CURRENCIES,
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
  CUSTOMER_CANCELLABLE_ORDER_STATUS_VALUES,
  CUSTOMER_CANCELLABLE_PAYMENT_STATUS_VALUES,
  ORDER_PAYMENT_METHODS,
  ORDER_STATUS_TRANSITIONS,
  ORDER_STATUS_TRANSITION_ACTION_MAP,
  ORDER_STATUS_TRANSITION_ACTIONS,
  ORDER_RETURN_ELIGIBLE_ORDER_STATUS_VALUES,
  ORDER_RETURN_ITEM_INSPECTION_STATUS_VALUES,
  ORDER_RETURN_REASONS,
  ORDER_RETURN_STATUSES,
  ORDER_RETURN_ITEM_INSPECTION_STATUSES,
  CUSTOMER_CANCELLABLE_ORDER_RETURN_STATUS_VALUES,
  ADMIN_RETURN_DECISION_ALLOWED_STATUS_VALUES,
  ADMIN_RETURN_MARK_IN_TRANSIT_ALLOWED_STATUS_VALUES,
  ADMIN_RETURN_RECEIPT_ALLOWED_STATUS_VALUES,
  ADMIN_RETURN_INSPECTION_ALLOWED_STATUS_VALUES,
  ADMIN_RETURN_COMPLETION_ALLOWED_STATUS_VALUES,
  ADMIN_RETURN_REFUND_ALLOWED_STATUS_VALUES,
  ORDER_RETURN_RESOLUTIONS,
} from "../../shared/constants/order.constants.js";

import { PRODUCT_INVENTORY_OPERATIONS } from "../../shared/constants/product-inventory.constants.js";

import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { createProductInventoryLedgerEntry } from "../products/product-inventory-ledger.repository.js";

import {
  findProductsForCheckout,
  findProductVariantInventorySnapshot,
  reserveVariantStockAtomically,
  releaseOrderVariantStockAtomically,
  commitOrderVariantStockAtomically,
  adjustVariantStockAtomically,
} from "../products/product.repository.js";

import {
  createOrderDocument,
  findExistingOrderNumber,
  findCustomerOrderById,
  listCustomerOrders,
  findCustomerOrderForCancellation,
  saveOrderDocument,
  listAdminOrders,
  findAdminOrderById,
  findAdminOrderForStatusUpdate,
  bumpOrderReturnRequestVersion,
  findCustomerOrderForReturnRequest,
} from "./order.repository.js";

import { createOrderRefundAuditEntry } from "./order-refund-audit.repository.js";
import {
  findConsumedOrderReturnQuantities,
  createOrderReturnRequestDocument,
  findExistingReturnRequestNumber,
  findCustomerOrderReturnRequestById,
  listCustomerOrderReturnRequests,
  findCustomerOrderReturnRequestForCancellation,
  saveOrderReturnRequestDocument,
  findAdminOrderReturnRequestById,
  listAdminOrderReturnRequests,
  findAdminOrderReturnRequestForDecision,
  findAdminOrderReturnRequestForProcessing,
} from "./order-return.repository.js";

import {
  createOrderReturnRefundAuditEntry,
  getOrderReturnRefundTotals,
} from "./order-return-refund-audit.repository.js";

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
| Customer Cancellation Lookup Sets
|--------------------------------------------------------------------------
*/

const CUSTOMER_CANCELLABLE_ORDER_STATUS_SET = new Set(
  CUSTOMER_CANCELLABLE_ORDER_STATUS_VALUES,
);

const CUSTOMER_CANCELLABLE_PAYMENT_STATUS_SET = new Set(
  CUSTOMER_CANCELLABLE_PAYMENT_STATUS_VALUES,
);

/*
|--------------------------------------------------------------------------
| Return Request Number Configuration
|--------------------------------------------------------------------------
*/

const ORDER_RETURN_REQUEST_NUMBER_PREFIX = "RET";

const MAX_RETURN_REQUEST_NUMBER_ATTEMPTS = 10;

/*
|--------------------------------------------------------------------------
| Return Inventory Restoration Configuration
|--------------------------------------------------------------------------
*/

const ORDER_RETURN_INVENTORY_ADJUSTMENT_REASON = "customer-return";

const ORDER_RETURN_INVENTORY_RESTORATION_NOTE =
  "Resellable customer Return stock restored during Return Request completion";

/*
|--------------------------------------------------------------------------
| Return Inventory Restoration Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnRestockInventoryStateInvalidError = ({
  productId,
  variantId,
}) => {
  return new AppError(
    "The Product inventory referenced by this Return Request is invalid",
    409,
    {
      errorCode: "ORDER_RETURN_RESTOCK_INVENTORY_STATE_INVALID",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

const createAdminOrderReturnRestockInventoryConflictError = ({
  productId,
  variantId,
}) => {
  return new AppError(
    "Product inventory changed while Return stock was being restored",
    409,
    {
      errorCode: "ORDER_RETURN_RESTOCK_INVENTORY_CONFLICT",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

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
| Customer Order Return Errors
|--------------------------------------------------------------------------
*/

const createCustomerReturnOrderNotFoundError = () => {
  return new AppError("Order was not found", 404, {
    errorCode: "ORDER_NOT_FOUND",
  });
};

const createCustomerReturnStatusInvalidError = (currentStatus) => {
  return new AppError("This Order is not eligible for a return request", 409, {
    errorCode: "ORDER_RETURN_STATUS_INVALID",

    details: {
      currentStatus,

      eligibleStatuses: ORDER_RETURN_ELIGIBLE_ORDER_STATUS_VALUES,
    },
  });
};

const createCustomerReturnDeliveryStateInvalidError = () => {
  return new AppError(
    "The Order must have a completed delivery before items can be returned",
    409,
    {
      errorCode: "ORDER_RETURN_DELIVERY_STATE_INVALID",
    },
  );
};

const createCustomerReturnInventoryStateInvalidError = (inventoryStatus) => {
  return new AppError(
    "The Order inventory state does not allow a return request",
    409,
    {
      errorCode: "ORDER_RETURN_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus,

        requiredInventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,
      },
    },
  );
};

const createCustomerReturnItemNotFoundError = (orderItemId) => {
  return new AppError(
    "A requested return item was not found in this Order",
    400,
    {
      errorCode: "ORDER_RETURN_ITEM_NOT_FOUND",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

const createCustomerReturnOrderItemStateInvalidError = (orderItemId) => {
  return new AppError(
    "The requested Order item has an invalid inventory state",
    409,
    {
      errorCode: "ORDER_RETURN_ITEM_STATE_INVALID",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

const createCustomerReturnQuantityExceededError = ({
  orderItemId,
  orderedQuantity,
  consumedQuantity,
  requestedQuantity,
}) => {
  const remainingQuantity = Math.max(orderedQuantity - consumedQuantity, 0);

  return new AppError(
    "The requested return quantity exceeds the remaining returnable quantity",
    409,
    {
      errorCode: "ORDER_RETURN_QUANTITY_EXCEEDED",

      details: {
        orderItemId: String(orderItemId),

        orderedQuantity,

        consumedQuantity,

        requestedQuantity,

        remainingQuantity,
      },
    },
  );
};

const createCustomerReturnDetailsRequiredError = (orderItemId) => {
  return new AppError(
    "Return details are required when the reason is other",
    400,
    {
      errorCode: "ORDER_RETURN_DETAILS_REQUIRED",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin Return Processing Conflict
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnProcessingConflictError = () => {
  return new AppError(
    "The Return Request was modified by another operation. Please refresh and try again.",
    409,
    {
      errorCode: "ORDER_RETURN_PROCESSING_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin Return Decision Concurrency Error
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnDecisionConflictError = () => {
  return new AppError(
    "The Return Request was modified by another operation. Please refresh and try again.",
    409,
    {
      errorCode: "ORDER_RETURN_DECISION_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin Return Linked Order State Error
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnOrderStateInvalidError = (orderId) => {
  return new AppError(
    "The Return Request is connected to an invalid Order state",
    409,
    {
      errorCode: "ORDER_RETURN_ORDER_STATE_INVALID",

      details: {
        orderId: String(orderId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Customer Return Request Not Found
|--------------------------------------------------------------------------
*/

const createCustomerReturnRequestNotFoundError = () => {
  return new AppError("Return request was not found", 404, {
    errorCode: "ORDER_RETURN_REQUEST_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Admin Return Request Not Found
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnRequestNotFoundError = () => {
  return new AppError("Return request was not found", 404, {
    errorCode: "ORDER_RETURN_REQUEST_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Admin Return Decision Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnAlreadyApprovedError = (returnRequest) => {
  return new AppError("This Return Request has already been approved", 409, {
    errorCode: "ORDER_RETURN_ALREADY_APPROVED",

    details: {
      status: returnRequest.status,

      approvedAt: returnRequest.approval?.approvedAt ?? null,
    },
  });
};

const createAdminOrderReturnAlreadyRejectedError = (returnRequest) => {
  return new AppError("This Return Request has already been rejected", 409, {
    errorCode: "ORDER_RETURN_ALREADY_REJECTED",

    details: {
      status: returnRequest.status,

      rejectedAt: returnRequest.rejection?.rejectedAt ?? null,
    },
  });
};

const createAdminOrderReturnApprovalStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be approved from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_APPROVAL_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_DECISION_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnRejectionStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be rejected from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_REJECTION_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_DECISION_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnDecisionStateInvalidError = (currentStatus) => {
  return new AppError(
    "The Return Request contains state that prevents an administrative decision",
    409,
    {
      errorCode: "ORDER_RETURN_DECISION_STATE_INVALID",

      details: {
        currentStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Inspection Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnAlreadyInspectedError = (returnRequest) => {
  const inspectedAt =
    (returnRequest.items ?? [])
      .map((item) => item.inspection?.inspectedAt)
      .filter(Boolean)[0] ?? null;

  return new AppError("This Return Request has already been inspected", 409, {
    errorCode: "ORDER_RETURN_ALREADY_INSPECTED",

    details: {
      status: returnRequest.status,

      inspectedAt,
    },
  });
};

const createAdminOrderReturnInspectionStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be inspected from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_INSPECTION_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_INSPECTION_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnInspectionStateInvalidError = (currentStatus) => {
  return new AppError(
    "The Return Request contains invalid warehouse inspection state",
    409,
    {
      errorCode: "ORDER_RETURN_INSPECTION_STATE_INVALID",

      details: {
        currentStatus,
      },
    },
  );
};

const createAdminOrderReturnInspectionItemNotFoundError = (orderItemId) => {
  return new AppError(
    "The selected Order item does not belong to this Return Request",
    400,
    {
      errorCode: "ORDER_RETURN_INSPECTION_ITEM_NOT_FOUND",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

const createAdminOrderReturnInspectionItemsIncompleteError = ({
  expectedItemCount,
  receivedItemCount,
}) => {
  return new AppError(
    "Every Return Request item must be inspected in the same operation",
    409,
    {
      errorCode: "ORDER_RETURN_INSPECTION_ITEMS_INCOMPLETE",

      details: {
        expectedItemCount,
        receivedItemCount,
      },
    },
  );
};

const createAdminOrderReturnInspectionQuantityInvalidError = ({
  orderItemId,
  returnedQuantity,
  inspectedQuantity,
}) => {
  return new AppError(
    "Inspection quantities must exactly equal the returned quantity",
    409,
    {
      errorCode: "ORDER_RETURN_INSPECTION_QUANTITY_INVALID",

      details: {
        orderItemId: String(orderItemId),

        returnedQuantity,

        inspectedQuantity,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Completion Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnAlreadyCompletedError = (returnRequest) => {
  return new AppError("This Return Request has already been completed", 409, {
    errorCode: "ORDER_RETURN_ALREADY_COMPLETED",

    details: {
      status: returnRequest.status,

      completedAt: returnRequest.completion?.completedAt ?? null,
    },
  });
};

const createAdminOrderReturnCompletionStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be completed from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_COMPLETION_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_COMPLETION_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnCompletionStateInvalidError = (currentStatus) => {
  return new AppError(
    "The Return Request contains invalid completion state",
    409,
    {
      errorCode: "ORDER_RETURN_COMPLETION_STATE_INVALID",

      details: {
        currentStatus,
      },
    },
  );
};

const createAdminOrderReturnCompletionInspectionInvalidError = (
  orderItemId,
) => {
  return new AppError(
    "A Return Request item does not contain a valid completed inspection",
    409,
    {
      errorCode: "ORDER_RETURN_COMPLETION_INSPECTION_INVALID",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Refund Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnAlreadyRefundedError = (returnRequest) => {
  return new AppError("This Return Request has already been refunded", 409, {
    errorCode: "ORDER_RETURN_ALREADY_REFUNDED",

    details: {
      status: returnRequest.status,

      refundedAt: returnRequest.refund?.refundedAt ?? null,

      referenceId: returnRequest.refund?.referenceId ?? null,
    },
  });
};

const createAdminOrderReturnRefundStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be refunded from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_REFUND_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnRefundResolutionInvalidError = (
  requestedResolution,
) => {
  return new AppError(
    "This Return Request does not use the refund resolution",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_RESOLUTION_INVALID",

      details: {
        requestedResolution,

        requiredResolution: ORDER_RETURN_RESOLUTIONS.REFUND,
      },
    },
  );
};

const createAdminOrderReturnRefundStateInvalidError = () => {
  return new AppError("The Return Request contains invalid refund state", 409, {
    errorCode: "ORDER_RETURN_REFUND_STATE_INVALID",
  });
};

const createAdminOrderReturnRefundOrderItemInvalidError = (orderItemId) => {
  return new AppError(
    "A Return item does not match the trusted Order item",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_ORDER_ITEM_INVALID",

      details: {
        orderItemId: String(orderItemId),
      },
    },
  );
};

const createAdminOrderReturnNothingRefundableError = () => {
  return new AppError(
    "This Return Request does not contain any refundable quantity",
    409,
    {
      errorCode: "ORDER_RETURN_NOTHING_REFUNDABLE",
    },
  );
};

const createAdminOrderReturnRefundPaymentStateInvalidError = (
  paymentStatus,
) => {
  return new AppError(
    "The Order payment state does not allow this Return refund",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_PAYMENT_STATE_INVALID",

      details: {
        paymentStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Refund Persistence Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnRefundReferenceConflictError = (referenceId) => {
  return new AppError(
    "The Return refund reference ID has already been used",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_REFERENCE_CONFLICT",

      details: {
        referenceId,
      },
    },
  );
};

const createAdminOrderReturnRefundExceedsOrderTotalError = ({
  orderGrandTotal,
  previousRefundAmount,
  requestedRefundAmount,
}) => {
  return new AppError(
    "The Return refund would exceed the refundable Order total",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_EXCEEDS_ORDER_TOTAL",

      details: {
        orderGrandTotal,

        previousRefundAmount,

        requestedRefundAmount,

        attemptedCumulativeRefundAmount:
          previousRefundAmount + requestedRefundAmount,
      },
    },
  );
};

const createAdminOrderReturnRefundOrderStateInvalidError = (orderId) => {
  return new AppError(
    "The Return Request is connected to an invalid Order refund state",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_ORDER_STATE_INVALID",

      details: {
        orderId: String(orderId),
      },
    },
  );
};

const createAdminOrderReturnRefundConflictError = () => {
  return new AppError(
    "The Return refund state changed while the refund was being processed. Please refresh and try again.",
    409,
    {
      errorCode: "ORDER_RETURN_REFUND_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Shipment Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnAlreadyInTransitError = (returnRequest) => {
  return new AppError(
    "This Return Request has already been marked as in transit",
    409,
    {
      errorCode: "ORDER_RETURN_ALREADY_IN_TRANSIT",

      details: {
        status: returnRequest.status,

        markedInTransitAt: returnRequest.shipment?.markedInTransitAt ?? null,
      },
    },
  );
};

const createAdminOrderReturnShipmentStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be marked as in transit from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_SHIPMENT_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_MARK_IN_TRANSIT_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnShipmentStateInvalidError = (currentStatus) => {
  return new AppError(
    "The Return Request contains invalid shipment-processing state",
    409,
    {
      errorCode: "ORDER_RETURN_SHIPMENT_STATE_INVALID",

      details: {
        currentStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Receipt Errors
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnAlreadyReceivedError = (returnRequest) => {
  return new AppError(
    "This Return Request has already been received by the warehouse",
    409,
    {
      errorCode: "ORDER_RETURN_ALREADY_RECEIVED",

      details: {
        status: returnRequest.status,

        receivedAt: returnRequest.receipt?.receivedAt ?? null,
      },
    },
  );
};

const createAdminOrderReturnReceiptStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This Return Request cannot be received from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_RECEIPT_STATUS_INVALID",

      details: {
        currentStatus,

        allowedStatuses: ADMIN_RETURN_RECEIPT_ALLOWED_STATUS_VALUES,
      },
    },
  );
};

const createAdminOrderReturnReceiptStateInvalidError = (currentStatus) => {
  return new AppError(
    "The Return Request contains invalid warehouse-receipt state",
    409,
    {
      errorCode: "ORDER_RETURN_RECEIPT_STATE_INVALID",

      details: {
        currentStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Customer Return Persistence Errors
|--------------------------------------------------------------------------
*/

const createCustomerReturnNumberConflictError = () => {
  return new AppError(
    "A unique return request number could not be generated",
    409,
    {
      errorCode: "ORDER_RETURN_NUMBER_CONFLICT",
    },
  );
};

const createCustomerReturnConcurrencyError = () => {
  return new AppError(
    "The Order return information changed while the request was being processed",
    409,
    {
      errorCode: "ORDER_RETURN_CONCURRENT_REQUEST",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Customer Return Cancellation Errors
|--------------------------------------------------------------------------
*/

const createCustomerReturnAlreadyCancelledError = (returnRequest) => {
  return new AppError("This return request has already been cancelled", 409, {
    errorCode: "ORDER_RETURN_ALREADY_CANCELLED",

    details: {
      status: returnRequest.status,

      cancelledAt: returnRequest.cancellation?.cancelledAt ?? null,
    },
  });
};

const createCustomerReturnCancellationStatusInvalidError = (currentStatus) => {
  return new AppError(
    "This return request cannot be cancelled from its current status",
    409,
    {
      errorCode: "ORDER_RETURN_CANCELLATION_STATUS_INVALID",

      details: {
        currentStatus,

        cancellableStatuses: CUSTOMER_CANCELLABLE_ORDER_RETURN_STATUS_VALUES,
      },
    },
  );
};

const createCustomerReturnCancellationStateInvalidError = (currentStatus) => {
  return new AppError(
    "The return request has already entered physical return processing",
    409,
    {
      errorCode: "ORDER_RETURN_CANCELLATION_STATE_INVALID",

      details: {
        currentStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Return Request Order Reference Error
|--------------------------------------------------------------------------
*/

const createCustomerReturnOrderStateInvalidError = (orderId) => {
  return new AppError(
    "The return request is connected to an invalid Order state",
    409,
    {
      errorCode: "ORDER_RETURN_ORDER_STATE_INVALID",

      details: {
        orderId: String(orderId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Customer Order Cancellation Errors
|--------------------------------------------------------------------------
*/

const createCustomerOrderCancellationNotAllowedError = (order) => {
  return new AppError(
    "This Order can no longer be cancelled by the customer",
    409,
    {
      errorCode: "ORDER_CANCELLATION_NOT_ALLOWED",

      details: {
        status: order.status,
      },
    },
  );
};

const createPaidOrderCancellationRequiresRefundError = (order) => {
  return new AppError(
    "This paid Order requires a refund workflow before it can be cancelled",
    409,
    {
      errorCode: "ORDER_CANCELLATION_REQUIRES_REFUND",

      details: {
        paymentStatus: order.payment?.status ?? null,
      },
    },
  );
};

const createOrderInventoryReleaseStateInvalidError = ({
  orderId,
  itemId = null,
  inventoryStatus = null,
}) => {
  return new AppError(
    "The Order inventory cannot be released from its current state",
    409,
    {
      errorCode: "ORDER_INVENTORY_RELEASE_STATE_INVALID",

      details: {
        orderId: String(orderId),

        itemId: itemId ? String(itemId) : null,

        inventoryStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin Order Not Found
|--------------------------------------------------------------------------
*/

const createAdminOrderNotFoundError = () => {
  return new AppError("Order was not found", 404, {
    errorCode: "ORDER_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Admin Order Status Transition Errors
|--------------------------------------------------------------------------
*/

const createSameOrderStatusError = (status) => {
  return new AppError("Order already has the requested status", 409, {
    errorCode: "ORDER_STATUS_ALREADY_SET",

    details: {
      status,
    },
  });
};

const createInvalidOrderStatusTransitionError = (
  currentStatus,
  targetStatus,
) => {
  return new AppError(
    "The requested Order status transition is not allowed",
    409,
    {
      errorCode: "ORDER_STATUS_TRANSITION_NOT_ALLOWED",

      details: {
        currentStatus,
        targetStatus,
      },
    },
  );
};

const createOrderConfirmationInventoryStateError = (inventoryStatus) => {
  return new AppError(
    "Order inventory must be fully reserved before confirmation",
    409,
    {
      errorCode: "ORDER_CONFIRMATION_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus,
      },
    },
  );
};

const createOrderConfirmationPaymentStateError = (
  paymentMethod,
  paymentStatus,
) => {
  return new AppError("Order payment state does not allow confirmation", 409, {
    errorCode: "ORDER_CONFIRMATION_PAYMENT_STATE_INVALID",

    details: {
      paymentMethod,
      paymentStatus,
    },
  });
};

const createOrderProcessingInventoryStateError = (inventoryStatus) => {
  return new AppError(
    "Order inventory must be committed before processing begins",
    409,
    {
      errorCode: "ORDER_PROCESSING_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus,
      },
    },
  );
};

const createDedicatedCancellationWorkflowRequiredError = () => {
  return new AppError(
    "Order cancellation must use the cancellation workflow",
    409,
    {
      errorCode: "ORDER_CANCELLATION_WORKFLOW_REQUIRED",
    },
  );
};

const createDedicatedRefundWorkflowRequiredError = () => {
  return new AppError("A delivered Order must use the refund workflow", 409, {
    errorCode: "ORDER_REFUND_WORKFLOW_REQUIRED",
  });
};

/*
|--------------------------------------------------------------------------
| Admin Order Shipment Errors
|--------------------------------------------------------------------------
*/

const createOrderShipmentAlreadyCreatedError = (order) => {
  return new AppError(
    "Shipment information already exists for this Order",
    409,
    {
      errorCode: "ORDER_SHIPMENT_ALREADY_CREATED",

      details: {
        status: order.status,

        trackingNumber: order.shipment?.trackingNumber ?? null,
      },
    },
  );
};

const createOrderShipmentStatusInvalidError = (currentStatus) => {
  return new AppError(
    "The Order cannot be shipped from its current status",
    409,
    {
      errorCode: "ORDER_SHIPMENT_STATUS_INVALID",

      details: {
        currentStatus,
        requiredStatus: ORDER_STATUSES.PROCESSING,
      },
    },
  );
};

const createOrderShipmentInventoryStateInvalidError = (inventoryStatus) => {
  return new AppError(
    "Order inventory must be fully committed before shipment",
    409,
    {
      errorCode: "ORDER_SHIPMENT_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus,
      },
    },
  );
};

const createOrderShipmentPaymentStateInvalidError = (
  paymentMethod,
  paymentStatus,
) => {
  return new AppError("Order payment state does not allow shipment", 409, {
    errorCode: "ORDER_SHIPMENT_PAYMENT_STATE_INVALID",

    details: {
      paymentMethod,
      paymentStatus,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Dedicated Delivery Workflow Required
|--------------------------------------------------------------------------
*/

const createDedicatedDeliveryWorkflowRequiredError = () => {
  return new AppError(
    "Order delivery must use the delivery completion workflow",
    409,
    {
      errorCode: "ORDER_DELIVERY_WORKFLOW_REQUIRED",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin Order Delivery Errors
|--------------------------------------------------------------------------
*/

const createOrderAlreadyDeliveredError = (order) => {
  return new AppError("This Order has already been delivered", 409, {
    errorCode: "ORDER_ALREADY_DELIVERED",

    details: {
      status: order.status,

      deliveredAt: order.shipment?.deliveredAt ?? null,
    },
  });
};

const createOrderDeliveryStatusInvalidError = (currentStatus) => {
  return new AppError(
    "The Order cannot be delivered from its current status",
    409,
    {
      errorCode: "ORDER_DELIVERY_STATUS_INVALID",

      details: {
        currentStatus,

        requiredStatus: ORDER_STATUSES.SHIPPED,
      },
    },
  );
};

const createOrderDeliveryShipmentStateInvalidError = () => {
  return new AppError(
    "The Order must contain valid shipment information before delivery",
    409,
    {
      errorCode: "ORDER_DELIVERY_SHIPMENT_STATE_INVALID",
    },
  );
};

const createOrderDeliveryInventoryStateInvalidError = (inventoryStatus) => {
  return new AppError(
    "Order inventory must remain committed before delivery",
    409,
    {
      errorCode: "ORDER_DELIVERY_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus,
      },
    },
  );
};

const createOrderDeliveryPaymentStateInvalidError = (
  paymentMethod,
  paymentStatus,
) => {
  return new AppError(
    "Order payment state does not allow delivery completion",
    409,
    {
      errorCode: "ORDER_DELIVERY_PAYMENT_STATE_INVALID",

      details: {
        paymentMethod,
        paymentStatus,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin Order Refund Errors
|--------------------------------------------------------------------------
*/

const createOrderAlreadyRefundedError = (order) => {
  return new AppError("This Order has already been refunded", 409, {
    errorCode: "ORDER_ALREADY_REFUNDED",

    details: {
      status: order.status,

      paymentStatus: order.payment?.status ?? null,

      refundedAt: order.payment?.refundedAt ?? order.refund?.refundedAt ?? null,

      referenceId: order.refund?.referenceId ?? null,
    },
  });
};

const createOrderRefundStatusInvalidError = (currentStatus) => {
  return new AppError(
    "The Order cannot be refunded from its current status",
    409,
    {
      errorCode: "ORDER_REFUND_STATUS_INVALID",

      details: {
        currentStatus,

        requiredStatus: ORDER_STATUSES.DELIVERED,
      },
    },
  );
};

const createOrderRefundDeliveryStateInvalidError = () => {
  return new AppError(
    "The Order must have a completed delivery before it can be refunded",
    409,
    {
      errorCode: "ORDER_REFUND_DELIVERY_STATE_INVALID",
    },
  );
};

const createOrderRefundInventoryStateInvalidError = (inventoryStatus) => {
  return new AppError(
    "Order inventory must remain committed before refund completion",
    409,
    {
      errorCode: "ORDER_REFUND_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus,
      },
    },
  );
};

const createOrderRefundPaymentStateInvalidError = (
  paymentMethod,
  paymentStatus,
) => {
  return new AppError("Only a fully paid Order can be refunded", 409, {
    errorCode: "ORDER_REFUND_PAYMENT_STATE_INVALID",

    details: {
      paymentMethod,
      paymentStatus,

      requiredPaymentStatus: ORDER_PAYMENT_STATUSES.PAID,
    },
  });
};

const createOrderRefundTotalInvalidError = (grandTotal, currency) => {
  return new AppError(
    "The Order does not contain a valid refundable total",
    409,
    {
      errorCode: "ORDER_REFUND_TOTAL_INVALID",

      details: {
        grandTotal,
        currency,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Refund Persistence Errors
|--------------------------------------------------------------------------
*/

const createOrderRefundReferenceConflictError = (referenceId) => {
  return new AppError("The refund reference ID has already been used", 409, {
    errorCode: "ORDER_REFUND_REFERENCE_CONFLICT",

    details: {
      referenceId,
    },
  });
};

const createConcurrentOrderRefundError = (orderId) => {
  return new AppError("This Order has already been refunded", 409, {
    errorCode: "ORDER_ALREADY_REFUNDED",

    details: {
      orderId: String(orderId),
    },
  });
};

const isMongoDuplicateKeyError = (error) => {
  return error?.code === 11000;
};

/*
|--------------------------------------------------------------------------
| Translate Return Refund Duplicate-Key Errors
|--------------------------------------------------------------------------
*/

const translateAdminOrderReturnRefundDuplicateError = (
  error,
  { returnRequest, referenceId },
) => {
  /*
    |--------------------------------------------------------------------------
    | External Reference Reused
    |--------------------------------------------------------------------------
    */

  if (error?.keyPattern?.referenceId || error?.keyValue?.referenceId) {
    return createAdminOrderReturnRefundReferenceConflictError(referenceId);
  }

  /*
    |--------------------------------------------------------------------------
    | Same Return Request Refunded Twice
    |--------------------------------------------------------------------------
    */

  if (
    error?.keyPattern?.returnRequest ||
    error?.keyValue?.returnRequest ||
    error?.keyPattern?.returnRequestNumber ||
    error?.keyValue?.returnRequestNumber
  ) {
    return createAdminOrderReturnAlreadyRefundedError(returnRequest);
  }

  return error;
};

/*
|--------------------------------------------------------------------------
| Order Inventory Commit Errors
|--------------------------------------------------------------------------
*/

const createOrderInventoryCommitStateInvalidError = ({
  orderId,
  itemId = null,
  productId = null,
  variantId = null,
}) => {
  return new AppError(
    "The Order inventory cannot be committed from its current state",
    409,
    {
      errorCode: "ORDER_INVENTORY_COMMIT_STATE_INVALID",

      details: {
        orderId: String(orderId),

        itemId: itemId ? String(itemId) : null,

        productId: productId ? String(productId) : null,

        variantId: variantId ? String(variantId) : null,
      },
    },
  );
};

const createOrderInventoryCommitConflictError = (productId, variantId) => {
  return new AppError(
    "Order inventory changed while confirmation was being processed",
    409,
    {
      errorCode: "ORDER_INVENTORY_COMMIT_CONFLICT",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Dedicated Shipment Workflow Required
|--------------------------------------------------------------------------
*/

const createDedicatedShipmentWorkflowRequiredError = () => {
  return new AppError("Order shipment must use the shipment workflow", 409, {
    errorCode: "ORDER_SHIPMENT_WORKFLOW_REQUIRED",
  });
};

/*
|--------------------------------------------------------------------------
| Assert Customer Order Is Return Eligible
|--------------------------------------------------------------------------
*/

const assertCustomerOrderIsReturnEligible = (order) => {
  /*
    |--------------------------------------------------------------------------
    | Order Status
    |--------------------------------------------------------------------------
    */

  if (!ORDER_RETURN_ELIGIBLE_ORDER_STATUS_VALUES.includes(order.status)) {
    throw createCustomerReturnStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Delivery Must Be Completed
    |--------------------------------------------------------------------------
    */

  if (!order.shipment?.deliveredAt) {
    throw createCustomerReturnDeliveryStateInvalidError();
  }

  /*
    |--------------------------------------------------------------------------
    | Order Inventory Must Remain Committed
    |--------------------------------------------------------------------------
    */

  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.COMMITTED) {
    throw createCustomerReturnInventoryStateInvalidError(order.inventoryStatus);
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createCustomerReturnInventoryStateInvalidError(order.inventoryStatus);
  }
};

/*
|--------------------------------------------------------------------------
| Build Trusted Order Item Map
|--------------------------------------------------------------------------
*/

const buildTrustedOrderItemMap = (orderItems) => {
  return new Map(
    orderItems.map((item) => {
      return [String(item._id), item];
    }),
  );
};

/*
|--------------------------------------------------------------------------
| Build Consumed Return Quantity Map
|--------------------------------------------------------------------------
*/

const buildConsumedReturnQuantityMap = (consumedQuantities) => {
  return new Map(
    consumedQuantities.map((entry) => {
      return [String(entry.orderItemId), Number(entry.consumedQuantity)];
    }),
  );
};

/*
|--------------------------------------------------------------------------
| Build Trusted Customer Return Items
|--------------------------------------------------------------------------
*/

const buildTrustedCustomerReturnItems = ({
  order,
  requestedItems,
  consumedQuantities,
}) => {
  const trustedOrderItemMap = buildTrustedOrderItemMap(order.items);

  const consumedQuantityMap =
    buildConsumedReturnQuantityMap(consumedQuantities);

  return requestedItems.map((requestedItem) => {
    const orderItemId = String(requestedItem.orderItemId);

    const trustedOrderItem = trustedOrderItemMap.get(orderItemId);

    /*
        |--------------------------------------------------------------------------
        | Item Must Belong to the Order
        |--------------------------------------------------------------------------
        */

    if (!trustedOrderItem) {
      throw createCustomerReturnItemNotFoundError(requestedItem.orderItemId);
    }

    /*
        |--------------------------------------------------------------------------
        | Item Inventory Must Be Committed
        |--------------------------------------------------------------------------
        */

    const itemInventory = trustedOrderItem.inventory;

    const orderedQuantity = Number(trustedOrderItem.quantity);

    const itemIsCommitted =
      itemInventory?.status === ORDER_INVENTORY_STATUSES.COMMITTED &&
      itemInventory.reservedQuantity === 0 &&
      itemInventory.committedQuantity === orderedQuantity &&
      itemInventory.releasedQuantity === 0;

    if (!itemIsCommitted) {
      throw createCustomerReturnOrderItemStateInvalidError(
        trustedOrderItem._id,
      );
    }

    /*
        |--------------------------------------------------------------------------
        | Details Required for "Other"
        |--------------------------------------------------------------------------
        */

    if (
      requestedItem.reason === ORDER_RETURN_REASONS.OTHER &&
      !requestedItem.details
    ) {
      throw createCustomerReturnDetailsRequiredError(trustedOrderItem._id);
    }

    /*
        |--------------------------------------------------------------------------
        | Protect Return Quantity
        |--------------------------------------------------------------------------
        */

    const consumedQuantity = consumedQuantityMap.get(orderItemId) ?? 0;

    const requestedQuantity = requestedItem.quantity;

    const remainingQuantity = orderedQuantity - consumedQuantity;

    if (requestedQuantity > remainingQuantity) {
      throw createCustomerReturnQuantityExceededError({
        orderItemId: trustedOrderItem._id,

        orderedQuantity,

        consumedQuantity,

        requestedQuantity,
      });
    }

    /*
        |--------------------------------------------------------------------------
        | Build Trusted Snapshot
        |--------------------------------------------------------------------------
        */

    return {
      orderItemId: trustedOrderItem._id,

      product: trustedOrderItem.product,

      variantId: trustedOrderItem.variantId,

      sku: trustedOrderItem.sku,

      productName: trustedOrderItem.productName,

      size: trustedOrderItem.size ?? null,

      color: {
        name: trustedOrderItem.color?.name ?? null,

        code: trustedOrderItem.color?.code ?? null,
      },

      quantity: requestedQuantity,

      reason: requestedItem.reason,

      details: requestedItem.details ?? null,

      inspection: {
        status: ORDER_RETURN_ITEM_INSPECTION_STATUSES.PENDING,

        resellableQuantity: 0,

        damagedQuantity: 0,

        rejectedQuantity: 0,

        note: null,

        inspectedBy: null,

        inspectedAt: null,
      },
    };
  });
};

/*
|--------------------------------------------------------------------------
| Build Trusted Return Item Map
|--------------------------------------------------------------------------
*/

const buildTrustedOrderReturnItemMap = (returnRequest) => {
  return new Map(
    (returnRequest.items ?? []).map((item) => [String(item.orderItemId), item]),
  );
};

/*
|--------------------------------------------------------------------------
| Build Trusted Inspection Items
|--------------------------------------------------------------------------
*/

const buildTrustedAdminOrderReturnInspectionItems = (
  returnRequest,
  inspectionItems,
  { adminId, inspectedAt },
) => {
  assertAllOrderReturnItemsAreIncludedForInspection(
    returnRequest,
    inspectionItems,
  );

  const trustedReturnItemMap = buildTrustedOrderReturnItemMap(returnRequest);

  return inspectionItems.map((inspectionItem) => {
    const orderItemId = String(inspectionItem.orderItemId);

    const trustedReturnItem = trustedReturnItemMap.get(orderItemId);

    if (!trustedReturnItem) {
      throw createAdminOrderReturnInspectionItemNotFoundError(orderItemId);
    }

    const resellableQuantity = Number(inspectionItem.resellableQuantity);

    const damagedQuantity = Number(inspectionItem.damagedQuantity);

    const rejectedQuantity = Number(inspectionItem.rejectedQuantity);

    const inspectedQuantity =
      resellableQuantity + damagedQuantity + rejectedQuantity;

    const returnedQuantity = Number(trustedReturnItem.quantity);

    if (inspectedQuantity !== returnedQuantity) {
      throw createAdminOrderReturnInspectionQuantityInvalidError({
        orderItemId,

        returnedQuantity,

        inspectedQuantity,
      });
    }

    return {
      orderItemId,

      inspection: {
        status: ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED,

        resellableQuantity,

        damagedQuantity,

        rejectedQuantity,

        note: inspectionItem.note ?? null,

        inspectedBy: adminId,

        inspectedAt,
      },
    };
  });
};

/*
|--------------------------------------------------------------------------
| Create Return Request Number Candidate
|--------------------------------------------------------------------------
*/

const createReturnRequestNumberCandidate = () => {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  const randomPart = new mongoose.Types.ObjectId()
    .toString()
    .slice(-12)
    .toUpperCase();

  return (
    `${ORDER_RETURN_REQUEST_NUMBER_PREFIX}-` + `${datePart}-` + `${randomPart}`
  );
};

/*
|--------------------------------------------------------------------------
| Generate Unique Return Request Number
|--------------------------------------------------------------------------
*/

const generateUniqueReturnRequestNumber = async ({ session } = {}) => {
  for (
    let attempt = 0;
    attempt < MAX_RETURN_REQUEST_NUMBER_ATTEMPTS;
    attempt += 1
  ) {
    const candidate = createReturnRequestNumberCandidate();

    const existingReturnRequest = await findExistingReturnRequestNumber(
      candidate,
      {
        session,
      },
    );

    if (!existingReturnRequest) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique return request number");
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Shipment Evidence Exists
|--------------------------------------------------------------------------
*/

const orderReturnShipmentEvidenceExists = (returnRequest) => {
  const shipment = returnRequest.shipment;

  if (!shipment) {
    return false;
  }

  return Boolean(
    shipment.carrier ||
    shipment.trackingNumber ||
    shipment.trackingUrl ||
    shipment.note ||
    shipment.markedInTransitBy ||
    shipment.markedInTransitAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Shipment Evidence Is Complete
|--------------------------------------------------------------------------
*/

const orderReturnShipmentEvidenceIsComplete = (returnRequest) => {
  const shipment = returnRequest.shipment;

  return Boolean(
    shipment?.carrier &&
    shipment?.trackingNumber &&
    shipment?.markedInTransitBy &&
    shipment?.markedInTransitAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Received
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyReceived = (returnRequest) => {
  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.RECEIVED ||
    returnRequest.status === ORDER_RETURN_STATUSES.INSPECTED ||
    returnRequest.status === ORDER_RETURN_STATUSES.COMPLETED ||
    returnRequest.receipt?.receivedAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already In Transit
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyInTransit = (returnRequest) => {
  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.IN_TRANSIT ||
    returnRequest.shipment?.markedInTransitAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Inspection or Completion Has Started
|--------------------------------------------------------------------------
*/

const orderReturnPostReceiptProcessingHasStarted = (returnRequest) => {
  const itemInspectionStarted = (returnRequest.items ?? []).some((item) => {
    return (
      item.inspection?.status ===
      ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED
    );
  });

  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.INSPECTED ||
    returnRequest.status === ORDER_RETURN_STATUSES.COMPLETED ||
    returnRequest.completion?.completedAt ||
    itemInspectionStarted,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Completed
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyCompleted = (returnRequest) => {
  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.COMPLETED ||
    returnRequest.completion?.completedAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Approved
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyApproved = (returnRequest) => {
  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.APPROVED ||
    returnRequest.approval?.approvedAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Rejected
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyRejected = (returnRequest) => {
  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.REJECTED ||
    returnRequest.rejection?.rejectedAt,
  );
};

/*
|--------------------------------------------------------------------------
| Assert Return Request Has Clean Decision State
|--------------------------------------------------------------------------
|
| Approval or rejection must not proceed when physical processing,
| cancellation, receipt, inspection, or completion evidence exists.
|--------------------------------------------------------------------------
*/

const assertAdminOrderReturnDecisionStateIsClean = (returnRequest) => {
  const cancellationExists = Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.CANCELLED ||
    returnRequest.cancellation?.cancelledAt,
  );

  const physicalProcessingStarted =
    orderReturnPhysicalProcessingHasStarted(returnRequest);

  if (cancellationExists || physicalProcessingStarted) {
    throw createAdminOrderReturnDecisionStateInvalidError(returnRequest.status);
  }
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Return Approval
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnApproval = async ({
  returnRequestId,
  adminId,
  approvalData,
}) => {
  const session = await mongoose.startSession();

  try {
    let approvedReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Load Return Request
          |--------------------------------------------------------------------------
          */

        const returnRequest = await findAdminOrderReturnRequestForDecision(
          returnRequestId,
          {
            session,
          },
        );

        if (!returnRequest) {
          throw createAdminOrderReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Approval State
          |--------------------------------------------------------------------------
          */

        const approvedAt = new Date();

        const approvedState = buildAdminApprovedOrderReturnState(
          returnRequest,
          {
            approvalData,
            adminId,
            approvedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Apply and Save Approval
          |--------------------------------------------------------------------------
          */

        returnRequest.set(approvedState);

        approvedReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return approvedReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnDecisionConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Return Rejection
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnRejection = async ({
  returnRequestId,
  adminId,
  rejectionData,
}) => {
  const session = await mongoose.startSession();

  try {
    let rejectedReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Load Return Request
          |--------------------------------------------------------------------------
          */

        const returnRequest = await findAdminOrderReturnRequestForDecision(
          returnRequestId,
          {
            session,
          },
        );

        if (!returnRequest) {
          throw createAdminOrderReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Rejection State
          |--------------------------------------------------------------------------
          */

        const rejectedAt = new Date();

        const rejectedState = buildAdminRejectedOrderReturnState(
          returnRequest,
          {
            rejectionData,
            adminId,
            rejectedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Synchronize Released Return Quantity
          |--------------------------------------------------------------------------
          |
          | requested consumes quantity.
          | rejected does not consume quantity.
          |
          | Incrementing the linked Order version synchronizes rejection with
          | concurrent customer Return Request creation.
          |--------------------------------------------------------------------------
          */

        const orderMatched = await bumpOrderReturnRequestVersion(
          returnRequest.order,
          returnRequest.customer,
          {
            session,
          },
        );

        if (!orderMatched) {
          throw createAdminOrderReturnOrderStateInvalidError(
            returnRequest.order,
          );
        }

        /*
          |--------------------------------------------------------------------------
          | Apply and Save Rejection
          |--------------------------------------------------------------------------
          */

        returnRequest.set(rejectedState);

        rejectedReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return rejectedReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnDecisionConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Return Inspection
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnInspection = async ({
  returnRequestId,
  adminId,
  inspectionData,
}) => {
  const session = await mongoose.startSession();

  try {
    let inspectedReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

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
          throw createAdminOrderReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Inspection State
          |--------------------------------------------------------------------------
          */

        const inspectedAt = new Date();

        const inspectedState = buildAdminOrderReturnInspectedState(
          returnRequest,
          {
            inspectionData,
            adminId,
            inspectedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Apply Only Mutable Inspection State
          |--------------------------------------------------------------------------
          |
          | Do not replace the complete Return-item array.
          |--------------------------------------------------------------------------
          */

        applyAdminOrderReturnInspectedState(returnRequest, inspectedState);

        /*
          |--------------------------------------------------------------------------
          | Persist Inspection
          |--------------------------------------------------------------------------
          */

        inspectedReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return inspectedReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnProcessingConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Request Can Be Approved
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeApproved = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Approval
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyApproved(returnRequest)) {
    throw createAdminOrderReturnAlreadyApprovedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Existing Rejection
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyRejected(returnRequest)) {
    throw createAdminOrderReturnAlreadyRejectedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Current Status
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_DECISION_ALLOWED_STATUS_VALUES.includes(returnRequest.status)
  ) {
    throw createAdminOrderReturnApprovalStatusInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | State Consistency
    |--------------------------------------------------------------------------
    */

  assertAdminOrderReturnDecisionStateIsClean(returnRequest);

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.APPROVED,

    releasesReturnQuantity: false,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Request Can Be Rejected
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeRejected = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Rejection
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyRejected(returnRequest)) {
    throw createAdminOrderReturnAlreadyRejectedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Existing Approval
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyApproved(returnRequest)) {
    throw createAdminOrderReturnAlreadyApprovedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Current Status
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_DECISION_ALLOWED_STATUS_VALUES.includes(returnRequest.status)
  ) {
    throw createAdminOrderReturnRejectionStatusInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | State Consistency
    |--------------------------------------------------------------------------
    */

  assertAdminOrderReturnDecisionStateIsClean(returnRequest);

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.REJECTED,

    releasesReturnQuantity: true,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Request Can Be Marked In Transit
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeMarkedInTransit = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Already Received
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyReceived(returnRequest)) {
    throw createAdminOrderReturnAlreadyReceivedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Duplicate In-Transit Operation
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyInTransit(returnRequest)) {
    throw createAdminOrderReturnAlreadyInTransitError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Allowed Status
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_MARK_IN_TRANSIT_ALLOWED_STATUS_VALUES.includes(
      returnRequest.status,
    )
  ) {
    throw createAdminOrderReturnShipmentStatusInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Approval Evidence Is Required
    |--------------------------------------------------------------------------
    */

  if (
    !returnRequest.approval?.approvedBy ||
    !returnRequest.approval?.approvedAt
  ) {
    throw createAdminOrderReturnShipmentStateInvalidError(returnRequest.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Terminal and Physical State Must Be Clean
    |--------------------------------------------------------------------------
    */

  const terminalEvidenceExists = Boolean(
    returnRequest.rejection?.rejectedAt ||
    returnRequest.cancellation?.cancelledAt ||
    returnRequest.receipt?.receivedAt ||
    returnRequest.completion?.completedAt,
  );

  if (
    terminalEvidenceExists ||
    orderReturnPostReceiptProcessingHasStarted(returnRequest)
  ) {
    throw createAdminOrderReturnShipmentStateInvalidError(returnRequest.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Partial Existing Shipment Evidence Is Invalid
    |--------------------------------------------------------------------------
    */

  if (orderReturnShipmentEvidenceExists(returnRequest)) {
    throw createAdminOrderReturnShipmentStateInvalidError(returnRequest.status);
  }

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.IN_TRANSIT,

    changesReturnQuantity: false,

    changesProductInventory: false,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Request Can Be Received
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeReceived = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Warehouse Receipt
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyReceived(returnRequest)) {
    throw createAdminOrderReturnAlreadyReceivedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Allowed Status
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_RECEIPT_ALLOWED_STATUS_VALUES.includes(returnRequest.status)
  ) {
    throw createAdminOrderReturnReceiptStatusInvalidError(returnRequest.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Shipment Evidence Must Be Complete
    |--------------------------------------------------------------------------
    */

  if (!orderReturnShipmentEvidenceIsComplete(returnRequest)) {
    throw createAdminOrderReturnReceiptStateInvalidError(returnRequest.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Return Must Not Be Cancelled or Rejected
    |--------------------------------------------------------------------------
    */

  const invalidTerminalEvidenceExists = Boolean(
    returnRequest.rejection?.rejectedAt ||
    returnRequest.cancellation?.cancelledAt,
  );

  if (invalidTerminalEvidenceExists) {
    throw createAdminOrderReturnReceiptStateInvalidError(returnRequest.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Inspection and Completion Must Not Have Started
    |--------------------------------------------------------------------------
    */

  if (orderReturnPostReceiptProcessingHasStarted(returnRequest)) {
    throw createAdminOrderReturnReceiptStateInvalidError(returnRequest.status);
  }

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.RECEIVED,

    changesReturnQuantity: false,

    changesProductInventory: false,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Request Can Be Inspected
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeInspected = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Inspection
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyInspected(returnRequest)) {
    throw createAdminOrderReturnAlreadyInspectedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Allowed Status
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_INSPECTION_ALLOWED_STATUS_VALUES.includes(
      returnRequest.status,
    )
  ) {
    throw createAdminOrderReturnInspectionStatusInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Receipt Audit Required
    |--------------------------------------------------------------------------
    */

  if (!orderReturnReceiptEvidenceIsComplete(returnRequest)) {
    throw createAdminOrderReturnInspectionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Shipment Evidence Must Still Exist
    |--------------------------------------------------------------------------
    */

  if (!orderReturnShipmentEvidenceIsComplete(returnRequest)) {
    throw createAdminOrderReturnInspectionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Approval Evidence Must Still Exist
    |--------------------------------------------------------------------------
    */

  if (
    !returnRequest.approval?.approvedBy ||
    !returnRequest.approval?.approvedAt
  ) {
    throw createAdminOrderReturnInspectionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Terminal Conflicts
    |--------------------------------------------------------------------------
    */

  const terminalConflictExists = Boolean(
    returnRequest.rejection?.rejectedAt ||
    returnRequest.cancellation?.cancelledAt ||
    returnRequest.completion?.completedAt,
  );

  if (terminalConflictExists) {
    throw createAdminOrderReturnInspectionStateInvalidError(
      returnRequest.status,
    );
  }

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.INSPECTED,

    changesReturnQuantity: false,

    changesProductInventory: false,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Return Item Inspection Is Complete
|--------------------------------------------------------------------------
*/

const assertOrderReturnItemInspectionIsComplete = (returnItem) => {
  const inspection = returnItem.inspection;

  if (
    !inspection ||
    inspection.status !== ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED ||
    !inspection.inspectedBy ||
    !inspection.inspectedAt
  ) {
    throw createAdminOrderReturnCompletionInspectionInvalidError(
      returnItem.orderItemId,
    );
  }

  const resellableQuantity = Number(inspection.resellableQuantity);

  const damagedQuantity = Number(inspection.damagedQuantity);

  const rejectedQuantity = Number(inspection.rejectedQuantity);

  const quantitiesAreValid =
    Number.isInteger(resellableQuantity) &&
    Number.isInteger(damagedQuantity) &&
    Number.isInteger(rejectedQuantity) &&
    resellableQuantity >= 0 &&
    damagedQuantity >= 0 &&
    rejectedQuantity >= 0;

  if (!quantitiesAreValid) {
    throw createAdminOrderReturnCompletionInspectionInvalidError(
      returnItem.orderItemId,
    );
  }

  const inspectedQuantity =
    resellableQuantity + damagedQuantity + rejectedQuantity;

  const returnedQuantity = Number(returnItem.quantity);

  if (inspectedQuantity !== returnedQuantity) {
    throw createAdminOrderReturnCompletionInspectionInvalidError(
      returnItem.orderItemId,
    );
  }

  return {
    resellableQuantity,
    damagedQuantity,
    rejectedQuantity,
    inspectedQuantity,
    returnedQuantity,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Request Can Be Completed
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeCompleted = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Completion
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyCompleted(returnRequest)) {
    throw createAdminOrderReturnAlreadyCompletedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Allowed Status
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_COMPLETION_ALLOWED_STATUS_VALUES.includes(
      returnRequest.status,
    )
  ) {
    throw createAdminOrderReturnCompletionStatusInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Approval Evidence
    |--------------------------------------------------------------------------
    */

  if (
    !returnRequest.approval?.approvedBy ||
    !returnRequest.approval?.approvedAt
  ) {
    throw createAdminOrderReturnCompletionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Shipment Evidence
    |--------------------------------------------------------------------------
    */

  if (!orderReturnShipmentEvidenceIsComplete(returnRequest)) {
    throw createAdminOrderReturnCompletionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Warehouse Receipt Evidence
    |--------------------------------------------------------------------------
    */

  if (!orderReturnReceiptEvidenceIsComplete(returnRequest)) {
    throw createAdminOrderReturnCompletionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Terminal Conflict Protection
    |--------------------------------------------------------------------------
    */

  if (
    returnRequest.rejection?.rejectedAt ||
    returnRequest.cancellation?.cancelledAt
  ) {
    throw createAdminOrderReturnCompletionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Return Items Must Exist
    |--------------------------------------------------------------------------
    */

  if (!Array.isArray(returnRequest.items) || returnRequest.items.length === 0) {
    throw createAdminOrderReturnCompletionStateInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Every Item Must Have Complete Inspection
    |--------------------------------------------------------------------------
    */

  for (const returnItem of returnRequest.items) {
    assertOrderReturnItemInspectionIsComplete(returnItem);
  }

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.COMPLETED,

    changesReturnQuantity: false,

    mayRestoreProductInventory: true,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Return Can Be Refunded
|--------------------------------------------------------------------------
*/

export const assertAdminOrderReturnCanBeRefunded = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Refund
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyRefunded(returnRequest)) {
    throw createAdminOrderReturnAlreadyRefundedError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Must Be Completed
    |--------------------------------------------------------------------------
    */

  if (
    !ADMIN_RETURN_REFUND_ALLOWED_STATUS_VALUES.includes(returnRequest.status)
  ) {
    throw createAdminOrderReturnRefundStatusInvalidError(returnRequest.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Must Be Refund Resolution
    |--------------------------------------------------------------------------
    */

  if (returnRequest.requestedResolution !== ORDER_RETURN_RESOLUTIONS.REFUND) {
    throw createAdminOrderReturnRefundResolutionInvalidError(
      returnRequest.requestedResolution,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Completion Audit Required
    |--------------------------------------------------------------------------
    */

  if (
    !returnRequest.completion?.completedBy ||
    !returnRequest.completion?.completedAt
  ) {
    throw createAdminOrderReturnRefundStateInvalidError();
  }

  /*
    |--------------------------------------------------------------------------
    | No Cancellation/Rejection
    |--------------------------------------------------------------------------
    */

  if (
    returnRequest.cancellation?.cancelledAt ||
    returnRequest.rejection?.rejectedAt
  ) {
    throw createAdminOrderReturnRefundStateInvalidError();
  }

  /*
    |--------------------------------------------------------------------------
    | Items Required
    |--------------------------------------------------------------------------
    */

  if (!Array.isArray(returnRequest.items) || returnRequest.items.length === 0) {
    throw createAdminOrderReturnRefundStateInvalidError();
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| Assert Return Refund Payment State
|--------------------------------------------------------------------------
*/

const assertOrderPaymentAllowsReturnRefund = (order) => {
  const paymentStatus = order.payment?.status;

  const allowed =
    paymentStatus === ORDER_PAYMENT_STATUSES.PAID ||
    paymentStatus === ORDER_PAYMENT_STATUSES.PARTIALLY_REFUNDED;

  if (!allowed) {
    throw createAdminOrderReturnRefundPaymentStateInvalidError(paymentStatus);
  }

  return paymentStatus;
};

/*
|--------------------------------------------------------------------------
| Assert All Return Items Are Included for Inspection
|--------------------------------------------------------------------------
*/

const assertAllOrderReturnItemsAreIncludedForInspection = (
  returnRequest,
  inspectionItems,
) => {
  const expectedItemCount = (returnRequest.items ?? []).length;

  const receivedItemCount = inspectionItems.length;

  if (expectedItemCount !== receivedItemCount) {
    throw createAdminOrderReturnInspectionItemsIncompleteError({
      expectedItemCount,
      receivedItemCount,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Check Transaction Conflict
|--------------------------------------------------------------------------
*/

const isOrderReturnTransactionConflict = (error) => {
  return Boolean(
    error?.errorLabels?.includes?.("TransientTransactionError") ||
    error?.code === 112 ||
    error?.codeName === "WriteConflict",
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Cancelled
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyCancelled = (returnRequest) => {
  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.CANCELLED ||
    returnRequest.cancellation?.cancelledAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Physical Return Processing Has Started
|--------------------------------------------------------------------------
*/

const orderReturnPhysicalProcessingHasStarted = (returnRequest) => {
  const itemInspectionStarted = (returnRequest.items ?? []).some((item) => {
    return (
      item.inspection?.status ===
      ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED
    );
  });

  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.IN_TRANSIT ||
    returnRequest.status === ORDER_RETURN_STATUSES.RECEIVED ||
    returnRequest.status === ORDER_RETURN_STATUSES.INSPECTED ||
    returnRequest.status === ORDER_RETURN_STATUSES.COMPLETED ||
    returnRequest.receipt?.receivedAt ||
    returnRequest.completion?.completedAt ||
    itemInspectionStarted,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Inspected
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyInspected = (returnRequest) => {
  const itemInspectionExists = (returnRequest.items ?? []).some((item) => {
    return (
      item.inspection?.status ===
        ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED ||
      item.inspection?.inspectedAt
    );
  });

  return Boolean(
    returnRequest.status === ORDER_RETURN_STATUSES.INSPECTED ||
    returnRequest.status === ORDER_RETURN_STATUSES.COMPLETED ||
    itemInspectionExists,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Return Request Is Already Refunded
|--------------------------------------------------------------------------
*/

const orderReturnRequestIsAlreadyRefunded = (returnRequest) => {
  return Boolean(
    returnRequest.refund?.refundedAt ||
    returnRequest.refund?.refundedBy ||
    returnRequest.refund?.referenceId,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Warehouse Receipt Evidence Is Complete
|--------------------------------------------------------------------------
*/

const orderReturnReceiptEvidenceIsComplete = (returnRequest) => {
  return Boolean(
    returnRequest.receipt?.receivedBy && returnRequest.receipt?.receivedAt,
  );
};

/*
|--------------------------------------------------------------------------
| Check Whether Order Was Already Refunded
|--------------------------------------------------------------------------
*/

const orderHasCompletedRefund = (order) => {
  return Boolean(
    order.status === ORDER_STATUSES.REFUNDED ||
    order.payment?.status === ORDER_PAYMENT_STATUSES.REFUNDED ||
    order.payment?.refundedAt ||
    order.refund?.refundedAt,
  );
};

/*
|--------------------------------------------------------------------------
| Assert Delivery Was Completed Before Refund
|--------------------------------------------------------------------------
*/

const assertOrderDeliveryCompletedForRefund = (order) => {
  const shipment = order.shipment;

  const deliveryCompleted = Boolean(
    shipment?.shippedAt && shipment?.deliveredAt,
  );

  if (!deliveryCompleted) {
    throw createOrderRefundDeliveryStateInvalidError();
  }
};

/*
|--------------------------------------------------------------------------
| Assert Refund Inventory Remains Committed
|--------------------------------------------------------------------------
|
| A refund does not automatically restock the Product.
|
| Returned goods must be inspected and restocked through a separate
| customer-return inventory adjustment.
|--------------------------------------------------------------------------
*/

const assertOrderInventoryRemainsCommittedForRefund = (order) => {
  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.COMMITTED) {
    throw createOrderRefundInventoryStateInvalidError(order.inventoryStatus);
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createOrderRefundInventoryStateInvalidError(order.inventoryStatus);
  }

  for (const item of order.items) {
    const inventory = item.inventory;

    const fullyCommitted =
      inventory?.status === ORDER_INVENTORY_STATUSES.COMMITTED &&
      inventory.reservedQuantity === 0 &&
      inventory.committedQuantity === item.quantity &&
      inventory.releasedQuantity === 0;

    if (!fullyCommitted) {
      throw createOrderRefundInventoryStateInvalidError(order.inventoryStatus);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Check Whether Order Was Already Delivered
|--------------------------------------------------------------------------
*/

const orderHasCompletedDelivery = (order) => {
  return Boolean(
    order.status === ORDER_STATUSES.DELIVERED || order.shipment?.deliveredAt,
  );
};

/*
|--------------------------------------------------------------------------
| Assert Shipment Is Ready for Delivery
|--------------------------------------------------------------------------
*/

const assertOrderShipmentIsReadyForDelivery = (order) => {
  const shipment = order.shipment;

  const validShipment = Boolean(
    shipment?.shippedAt && shipment?.carrier && shipment?.trackingNumber,
  );

  if (!validShipment) {
    throw createOrderDeliveryShipmentStateInvalidError();
  }
};

/*
|--------------------------------------------------------------------------
| Assert Delivery Inventory Remains Committed
|--------------------------------------------------------------------------
*/

const assertOrderInventoryRemainsCommittedForDelivery = (order) => {
  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.COMMITTED) {
    throw createOrderDeliveryInventoryStateInvalidError(order.inventoryStatus);
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createOrderDeliveryInventoryStateInvalidError(order.inventoryStatus);
  }

  for (const item of order.items) {
    const inventory = item.inventory;

    const fullyCommitted =
      inventory?.status === ORDER_INVENTORY_STATUSES.COMMITTED &&
      inventory.reservedQuantity === 0 &&
      inventory.committedQuantity === item.quantity &&
      inventory.releasedQuantity === 0;

    if (!fullyCommitted) {
      throw createOrderDeliveryInventoryStateInvalidError(
        order.inventoryStatus,
      );
    }
  }
};

/*
|--------------------------------------------------------------------------
| Check Existing Order Shipment
|--------------------------------------------------------------------------
*/

const orderHasShipmentInformation = (order) => {
  return Boolean(
    order.shipment?.shippedAt ||
    order.shipment?.trackingNumber ||
    order.shipment?.carrier,
  );
};

/*
|--------------------------------------------------------------------------
| Assert Order Items Are Fully Committed
|--------------------------------------------------------------------------
*/

const assertOrderItemsAreFullyCommitted = (order) => {
  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.COMMITTED) {
    throw createOrderShipmentInventoryStateInvalidError(order.inventoryStatus);
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createOrderShipmentInventoryStateInvalidError(order.inventoryStatus);
  }

  for (const item of order.items) {
    const inventory = item.inventory;

    const fullyCommitted =
      inventory?.status === ORDER_INVENTORY_STATUSES.COMMITTED &&
      inventory.reservedQuantity === 0 &&
      inventory.committedQuantity === item.quantity &&
      inventory.releasedQuantity === 0;

    if (!fullyCommitted) {
      throw createOrderShipmentInventoryStateInvalidError(
        order.inventoryStatus,
      );
    }
  }
};

/*
|--------------------------------------------------------------------------
| Assert Order Payment Allows Shipment
|--------------------------------------------------------------------------
|
| Cash on delivery:
| - pending or paid is allowed.
|
| Online:
| - payment must be paid.
|--------------------------------------------------------------------------
*/

const assertOrderPaymentAllowsShipment = (order) => {
  const paymentMethod = order.payment?.method;

  const paymentStatus = order.payment?.status;

  if (paymentMethod === ORDER_PAYMENT_METHODS.CASH_ON_DELIVERY) {
    const validStatus =
      paymentStatus === ORDER_PAYMENT_STATUSES.PENDING ||
      paymentStatus === ORDER_PAYMENT_STATUSES.PAID;

    if (validStatus) {
      return;
    }
  }

  if (
    paymentMethod === ORDER_PAYMENT_METHODS.ONLINE &&
    paymentStatus === ORDER_PAYMENT_STATUSES.PAID
  ) {
    return;
  }

  throw createOrderShipmentPaymentStateInvalidError(
    paymentMethod,
    paymentStatus,
  );
};
/*
|--------------------------------------------------------------------------
| Admin Order Status Notes
|--------------------------------------------------------------------------
*/

const ADMIN_ORDER_STATUS_DEFAULT_NOTES = Object.freeze({
  [ORDER_STATUSES.CONFIRMED]: "Order confirmed by admin",

  [ORDER_STATUSES.PROCESSING]: "Order processing started",

  [ORDER_STATUSES.SHIPPED]: "Order shipped",

  [ORDER_STATUSES.DELIVERED]: "Order delivered",

  [ORDER_STATUSES.CANCELLED]: "Order cancelled by admin",

  [ORDER_STATUSES.REFUNDED]: "Order refunded",
});
/*
|--------------------------------------------------------------------------
| Find Updated Committed Variant
|--------------------------------------------------------------------------
*/

const findUpdatedCommittedVariant = (product, variantId) => {
  const variant = (product.variants ?? []).find((candidate) => {
    return String(candidate._id) === String(variantId);
  });

  if (!variant) {
    throw createOrderInventoryCommitStateInvalidError({
      orderId: product._id,

      productId: product._id,

      variantId,
    });
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Find Updated Return-Restocked Variant
|--------------------------------------------------------------------------
*/

const findUpdatedReturnRestockedVariant = (product, variantId) => {
  const variant = (product.variants ?? []).find((candidate) => {
    return String(candidate._id) === String(variantId);
  });

  if (!variant) {
    throw createAdminOrderReturnRestockInventoryStateInvalidError({
      productId: product._id,

      variantId,
    });
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Return Inventory Restoration
|--------------------------------------------------------------------------
*/

const diagnoseFailedAdminOrderReturnInventoryRestoration = async ({
  productId,
  variantId,
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
    | Missing / Deleted Product
    |--------------------------------------------------------------------------
    */

  if (!snapshot || snapshot.isDeleted) {
    throw createAdminOrderReturnRestockInventoryStateInvalidError({
      productId,
      variantId,
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Missing Variant
    |--------------------------------------------------------------------------
    */

  if (!snapshot.variant) {
    throw createAdminOrderReturnRestockInventoryStateInvalidError({
      productId,
      variantId,
    });
  }

  const { stock, reservedStock } = snapshot.variant;

  /*
    |--------------------------------------------------------------------------
    | Existing Inventory Must Be Consistent
    |--------------------------------------------------------------------------
    */

  const inventoryIsValid =
    Number.isInteger(stock) &&
    Number.isInteger(reservedStock) &&
    stock >= 0 &&
    reservedStock >= 0 &&
    reservedStock <= stock;

  if (!inventoryIsValid) {
    throw createAdminOrderReturnRestockInventoryStateInvalidError({
      productId,
      variantId,
    });
  }

  /*
   * Snapshot looks healthy but atomic update did
   * not succeed.
   *
   * Treat it as concurrent inventory modification.
   */
  throw createAdminOrderReturnRestockInventoryConflictError({
    productId,
    variantId,
  });
};

/*
|--------------------------------------------------------------------------
| Create Return Inventory Restoration Ledger Entry
|--------------------------------------------------------------------------
*/

const createOrderReturnInventoryRestorationLedgerEntry = async ({
  updatedProduct,
  variantId,
  quantity,
  returnRequestNumber,
  actorUserId,
  session,
}) => {
  const updatedVariant = findUpdatedReturnRestockedVariant(
    updatedProduct,
    variantId,
  );

  const afterStock = updatedVariant.inventory?.stock ?? 0;

  const afterReservedStock = updatedVariant.inventory?.reservedStock ?? 0;

  /*
    |--------------------------------------------------------------------------
    | Reconstruct Before State
    |--------------------------------------------------------------------------
    |
    | Product has already been incremented atomically.
    |
    | afterStock = beforeStock + quantity
    |--------------------------------------------------------------------------
    */

  const beforeStock = afterStock - quantity;

  const beforeReservedStock = afterReservedStock;

  await createProductInventoryLedgerEntry(
    {
      product: updatedProduct._id,

      variantId: updatedVariant._id,

      sku: updatedVariant.sku,

      operation: PRODUCT_INVENTORY_OPERATIONS.ADJUST,

      quantity,

      stockDelta: quantity,

      reservedStockDelta: 0,

      before: buildOrderInventoryState(beforeStock, beforeReservedStock),

      after: buildOrderInventoryState(afterStock, afterReservedStock),

      reason: ORDER_RETURN_INVENTORY_ADJUSTMENT_REASON,

      note: ORDER_RETURN_INVENTORY_RESTORATION_NOTE,

      referenceId: returnRequestNumber,

      actor: actorUserId,
    },

    session,
  );

  return updatedVariant;
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Return Completion
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnCompletion = async ({
  returnRequestId,
  adminId,
  completionData,
}) => {
  const session = await mongoose.startSession();

  try {
    let completedReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

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
          throw createAdminOrderReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Shared Completion Timestamp
          |--------------------------------------------------------------------------
          */

        const completedAt = new Date();

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Inventory Restoration Plan
          |--------------------------------------------------------------------------
          |
          | This also validates:
          |
          | - status = inspected
          | - complete inspection evidence
          | - quantity consistency
          | - approval/shipment/receipt state
          |--------------------------------------------------------------------------
          */

        const restorationPlan =
          buildAdminOrderReturnInventoryRestorationPlan(returnRequest);

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Completed Return State
          |--------------------------------------------------------------------------
          |
          | Do this before Product mutation so all Return business rules
          | have been checked before inventory changes begin.
          |--------------------------------------------------------------------------
          */

        const completedState = buildAdminCompletedOrderReturnState(
          returnRequest,
          {
            completionData,
            adminId,
            completedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Restore Sellable Product Inventory
          |--------------------------------------------------------------------------
          */

        await restoreAdminOrderReturnInventoryInTransaction(restorationPlan, {
          returnRequestNumber: returnRequest.returnRequestNumber,

          actorUserId: adminId,

          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Mark Return Request Completed
          |--------------------------------------------------------------------------
          */

        returnRequest.set(completedState);

        /*
          |--------------------------------------------------------------------------
          | Save Return Request
          |--------------------------------------------------------------------------
          */

        completedReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return completedReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnProcessingConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Order Inventory Commit
|--------------------------------------------------------------------------
|
| Called only when the atomic Product update returns null.
|--------------------------------------------------------------------------
*/

const diagnoseFailedOrderInventoryCommit = async ({
  orderId,
  orderItemId,
  productId,
  variantId,
  commitQuantity,
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
    throw createOrderInventoryCommitStateInvalidError({
      orderId,

      itemId: orderItemId,

      productId,
      variantId,
    });
  }

  const { stock, reservedStock } = snapshot.variant;

  if (
    !Number.isInteger(stock) ||
    !Number.isInteger(reservedStock) ||
    stock < 0 ||
    reservedStock < 0 ||
    stock < commitQuantity ||
    reservedStock < commitQuantity
  ) {
    throw createOrderInventoryCommitStateInvalidError({
      orderId,

      itemId: orderItemId,

      productId,
      variantId,
    });
  }

  /*
   * The diagnostic read still shows enough stock and reservation,
   * but the atomic update did not match. Treat this as a concurrent
   * inventory conflict.
   */
  throw createOrderInventoryCommitConflictError(productId, variantId);
};

/*
|--------------------------------------------------------------------------
| Create Order Inventory Commit Ledger Entry
|--------------------------------------------------------------------------
*/

const createOrderInventoryCommitLedgerEntry = async ({
  updatedProduct,
  variantId,
  quantity,
  orderNumber,
  actorUserId,
  session,
}) => {
  const updatedVariant = findUpdatedCommittedVariant(updatedProduct, variantId);

  const afterStock = updatedVariant.inventory?.stock ?? 0;

  const afterReservedStock = updatedVariant.inventory?.reservedStock ?? 0;

  /*
   * The Product update has already decreased both values.
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

      before: buildOrderInventoryState(beforeStock, beforeReservedStock),

      after: buildOrderInventoryState(afterStock, afterReservedStock),

      referenceId: orderNumber,

      actor: actorUserId,
    },

    session,
  );

  return updatedVariant;
};
/*
|--------------------------------------------------------------------------
| Assert Complete Order Reservation
|--------------------------------------------------------------------------
*/

const assertOrderItemsAreFullyReserved = (order) => {
  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.RESERVED) {
    throw createOrderConfirmationInventoryStateError(order.inventoryStatus);
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createOrderConfirmationInventoryStateError(order.inventoryStatus);
  }

  for (const item of order.items) {
    const inventory = item.inventory;

    const fullyReserved =
      inventory?.status === ORDER_INVENTORY_STATUSES.RESERVED &&
      inventory.reservedQuantity === item.quantity &&
      inventory.committedQuantity === 0 &&
      inventory.releasedQuantity === 0;

    if (!fullyReserved) {
      throw createOrderConfirmationInventoryStateError(order.inventoryStatus);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Assert Order Payment Allows Confirmation
|--------------------------------------------------------------------------
|
| Cash on delivery:
| - pending or paid is acceptable.
|
| Online:
| - payment must already be paid.
|--------------------------------------------------------------------------
*/

const assertOrderPaymentAllowsConfirmation = (order) => {
  const paymentMethod = order.payment?.method;

  const paymentStatus = order.payment?.status;

  if (paymentMethod === ORDER_PAYMENT_METHODS.CASH_ON_DELIVERY) {
    const validCashOnDeliveryStatus =
      paymentStatus === ORDER_PAYMENT_STATUSES.PENDING ||
      paymentStatus === ORDER_PAYMENT_STATUSES.PAID;

    if (validCashOnDeliveryStatus) {
      return;
    }
  }

  if (
    paymentMethod === ORDER_PAYMENT_METHODS.ONLINE &&
    paymentStatus === ORDER_PAYMENT_STATUSES.PAID
  ) {
    return;
  }

  throw createOrderConfirmationPaymentStateError(paymentMethod, paymentStatus);
};

/*
|--------------------------------------------------------------------------
| Assert Order Can Begin Processing
|--------------------------------------------------------------------------
*/

const assertOrderCanBeginProcessing = (order) => {
  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.COMMITTED) {
    throw createOrderProcessingInventoryStateError(order.inventoryStatus);
  }

  for (const item of order.items) {
    const inventory = item.inventory;

    const fullyCommitted =
      inventory?.status === ORDER_INVENTORY_STATUSES.COMMITTED &&
      inventory.reservedQuantity === 0 &&
      inventory.committedQuantity === item.quantity &&
      inventory.releasedQuantity === 0;

    if (!fullyCommitted) {
      throw createOrderProcessingInventoryStateError(order.inventoryStatus);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Build Order Transition Key
|--------------------------------------------------------------------------
*/

const buildOrderStatusTransitionKey = (currentStatus, targetStatus) => {
  return `${currentStatus}:` + `${targetStatus}`;
};

/*
|--------------------------------------------------------------------------
| Get Admin Order Status Transition Plan
|--------------------------------------------------------------------------
|
| This validates the requested transition and returns the
| additional business operation required by that transition.
|--------------------------------------------------------------------------
*/

export const getAdminOrderStatusTransitionPlan = (order, targetStatus) => {
  const currentStatus = order.status;

  if (currentStatus === targetStatus) {
    throw createSameOrderStatusError(currentStatus);
  }

  const allowedTargetStatuses = ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (!allowedTargetStatuses.includes(targetStatus)) {
    throw createInvalidOrderStatusTransitionError(currentStatus, targetStatus);
  }

  const transitionKey = buildOrderStatusTransitionKey(
    currentStatus,
    targetStatus,
  );

  const action =
    ORDER_STATUS_TRANSITION_ACTION_MAP[transitionKey] ??
    ORDER_STATUS_TRANSITION_ACTIONS.NONE;

  /*
    |--------------------------------------------------------------------------
    | Pending → Confirmed
    |--------------------------------------------------------------------------
    */

  if (
    currentStatus === ORDER_STATUSES.PENDING &&
    targetStatus === ORDER_STATUSES.CONFIRMED
  ) {
    assertOrderItemsAreFullyReserved(order);

    assertOrderPaymentAllowsConfirmation(order);
  }

  /*
    |--------------------------------------------------------------------------
    | Confirmed → Processing
    |--------------------------------------------------------------------------
    */

  if (
    currentStatus === ORDER_STATUSES.CONFIRMED &&
    targetStatus === ORDER_STATUSES.PROCESSING
  ) {
    assertOrderCanBeginProcessing(order);
  }

  return {
    currentStatus,
    targetStatus,
    action,

    requiresInventoryCommit:
      action === ORDER_STATUS_TRANSITION_ACTIONS.COMMIT_RESERVED_INVENTORY,

    requiresInventoryRelease:
      action === ORDER_STATUS_TRANSITION_ACTIONS.RELEASE_RESERVED_INVENTORY,

    requiresShipment:
      action === ORDER_STATUS_TRANSITION_ACTIONS.REQUIRE_SHIPMENT,

    requiresDelivery:
      action === ORDER_STATUS_TRANSITION_ACTIONS.REQUIRE_DELIVERY,

    requiresRefund: action === ORDER_STATUS_TRANSITION_ACTIONS.REQUIRE_REFUND,
  };
};

/*
|--------------------------------------------------------------------------
| Get Admin Order by ID
|--------------------------------------------------------------------------
*/

export const getAdminOrderById = async (orderId) => {
  const order = await findAdminOrderById(orderId);

  if (!order) {
    throw createAdminOrderNotFoundError();
  }

  return order;
};

/*
|--------------------------------------------------------------------------
| Get Admin Order Return Requests
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnRequests = async (filters = {}) => {
  const {
    page = 1,

    limit = 20,
  } = filters;

  const { returnRequests, total } = await listAdminOrderReturnRequests(filters);

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    returnRequests,

    pagination: {
      page,

      limit,

      total,

      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Get Admin Order Return Request by ID
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnRequestById = async (returnRequestId) => {
  const returnRequest = await findAdminOrderReturnRequestById(returnRequestId);

  if (!returnRequest) {
    throw createAdminOrderReturnRequestNotFoundError();
  }

  return returnRequest;
};

/*
|--------------------------------------------------------------------------
| Get Customer Order Return Requests
|--------------------------------------------------------------------------
*/

export const getCustomerOrderReturnRequests = async (
  customerId,
  filters = {},
) => {
  if (!customerId) {
    throw new Error("Customer ID is required to list return requests");
  }

  const {
    page = 1,

    limit = 20,
  } = filters;

  const { returnRequests, total } = await listCustomerOrderReturnRequests(
    customerId,
    filters,
  );

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    returnRequests,

    pagination: {
      page,

      limit,

      total,

      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Get Customer Order Return Request by ID
|--------------------------------------------------------------------------
*/

export const getCustomerOrderReturnRequestById = async (
  returnRequestId,
  customerId,
) => {
  if (!customerId) {
    throw new Error("Customer ID is required to retrieve a return request");
  }

  const returnRequest = await findCustomerOrderReturnRequestById(
    returnRequestId,
    customerId,
  );

  if (!returnRequest) {
    throw createCustomerReturnRequestNotFoundError();
  }

  return returnRequest;
};

/*
|--------------------------------------------------------------------------
| Order Inventory Release Conflict
|--------------------------------------------------------------------------
*/

const createOrderInventoryReleaseConflictError = (productId, variantId) => {
  return new AppError(
    "Order inventory changed while cancellation was being processed",
    409,
    {
      errorCode: "ORDER_INVENTORY_RELEASE_CONFLICT",

      details: {
        productId: String(productId),

        variantId: String(variantId),
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Find Updated Released Variant
|--------------------------------------------------------------------------
*/

const findUpdatedReleasedVariant = (product, variantId) => {
  const variant = (product.variants ?? []).find((candidate) => {
    return String(candidate._id) === String(variantId);
  });

  if (!variant) {
    throw createOrderInventoryReleaseStateInvalidError({
      orderId: product._id,

      itemId: variantId,

      inventoryStatus: null,
    });
  }

  return variant;
};

/*
|--------------------------------------------------------------------------
| Diagnose Failed Order Reservation Release
|--------------------------------------------------------------------------
|
| Called only when the atomic Product update returns null.
|--------------------------------------------------------------------------
*/

const diagnoseFailedOrderReservationRelease = async ({
  orderId,
  orderItemId,
  productId,
  variantId,
  releaseQuantity,
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
    throw createOrderInventoryReleaseStateInvalidError({
      orderId,
      itemId: orderItemId,

      inventoryStatus: "variant-unavailable",
    });
  }

  const reservedStock = snapshot.variant.reservedStock;

  if (
    !Number.isInteger(reservedStock) ||
    reservedStock < 0 ||
    reservedStock < releaseQuantity
  ) {
    throw createOrderInventoryReleaseStateInvalidError({
      orderId,
      itemId: orderItemId,

      inventoryStatus: "insufficient-reserved-stock",
    });
  }

  /*
   * The diagnostic snapshot shows enough reserved stock,
   * but the atomic update still did not match.
   */
  throw createOrderInventoryReleaseConflictError(productId, variantId);
};

/*
|--------------------------------------------------------------------------
| Create Order Reservation Release Ledger
|--------------------------------------------------------------------------
*/

const createOrderReservationReleaseLedgerEntry = async ({
  updatedProduct,
  variantId,
  quantity,
  orderNumber,
  actorUserId,
  session,
}) => {
  const updatedVariant = findUpdatedReleasedVariant(updatedProduct, variantId);

  const afterStock = updatedVariant.inventory?.stock ?? 0;

  const afterReservedStock = updatedVariant.inventory?.reservedStock ?? 0;

  /*
   * The atomic update has already decreased reservedStock.
   *
   * beforeReservedStock =
   * afterReservedStock + released quantity
   */
  const beforeReservedStock = afterReservedStock + quantity;

  await createProductInventoryLedgerEntry(
    {
      product: updatedProduct._id,

      variantId: updatedVariant._id,

      sku: updatedVariant.sku,

      operation: PRODUCT_INVENTORY_OPERATIONS.RELEASE,

      quantity,

      stockDelta: 0,

      reservedStockDelta: -quantity,

      before: buildOrderInventoryState(afterStock, beforeReservedStock),

      after: buildOrderInventoryState(afterStock, afterReservedStock),

      referenceId: orderNumber,

      actor: actorUserId,
    },

    session,
  );

  return updatedVariant;
};

/*
|--------------------------------------------------------------------------
| Normalize Order Subdocument
|--------------------------------------------------------------------------
|
| Supports both:
|
| - Mongoose subdocuments
| - Lean database objects
|--------------------------------------------------------------------------
*/

const normalizeOrderSubdocument = (value) => {
  if (value && typeof value.toObject === "function") {
    return value.toObject();
  }

  return value;
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
| Get Admin Orders
|--------------------------------------------------------------------------
*/

export const getAdminOrders = async (filters) => {
  return listAdminOrders(filters);
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

/*
|--------------------------------------------------------------------------
| Assert Customer Order Can Be Cancelled
|--------------------------------------------------------------------------
*/

export const assertCustomerOrderCanBeCancelled = (order) => {
  /*
    |--------------------------------------------------------------------------
    | Order Status
    |--------------------------------------------------------------------------
    */

  if (!CUSTOMER_CANCELLABLE_ORDER_STATUS_SET.has(order.status)) {
    throw createCustomerOrderCancellationNotAllowedError(order);
  }

  /*
    |--------------------------------------------------------------------------
    | Payment Status
    |--------------------------------------------------------------------------
    |
    | Paid Orders require a refund workflow.
    |--------------------------------------------------------------------------
    */

  const paymentStatus = order.payment?.status;

  if (
    paymentStatus === ORDER_PAYMENT_STATUSES.PAID ||
    paymentStatus === ORDER_PAYMENT_STATUSES.PARTIALLY_REFUNDED ||
    paymentStatus === ORDER_PAYMENT_STATUSES.REFUNDED
  ) {
    throw createPaidOrderCancellationRequiresRefundError(order);
  }

  if (!CUSTOMER_CANCELLABLE_PAYMENT_STATUS_SET.has(paymentStatus)) {
    throw createCustomerOrderCancellationNotAllowedError(order);
  }

  /*
    |--------------------------------------------------------------------------
    | Order-Level Inventory State
    |--------------------------------------------------------------------------
    */

  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.RESERVED) {
    throw createOrderInventoryReleaseStateInvalidError({
      orderId: order._id,

      inventoryStatus: order.inventoryStatus,
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Order Items Must Exist
    |--------------------------------------------------------------------------
    */

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw createOrderInventoryReleaseStateInvalidError({
      orderId: order._id,

      inventoryStatus: order.inventoryStatus,
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Every Item Must Be Fully Reserved
    |--------------------------------------------------------------------------
    */

  for (const item of order.items) {
    const inventory = item.inventory;

    const inventoryIsValid =
      inventory?.status === ORDER_INVENTORY_STATUSES.RESERVED &&
      inventory.reservedQuantity === item.quantity &&
      inventory.committedQuantity === 0 &&
      inventory.releasedQuantity === 0;

    if (!inventoryIsValid) {
      throw createOrderInventoryReleaseStateInvalidError({
        orderId: order._id,

        itemId: item._id,

        inventoryStatus: inventory?.status ?? null,
      });
    }
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| Build Released Order Items
|--------------------------------------------------------------------------
|
| reservedQuantity remains as historical information showing
| how many units were originally reserved.
|
| releasedQuantity records how many units were released.
|--------------------------------------------------------------------------
*/

const buildReleasedOrderItems = (orderItems) => {
  return orderItems.map((item) => {
    const normalizedItem = normalizeOrderSubdocument(item);

    return {
      ...normalizedItem,

      inventory: {
        ...normalizedItem.inventory,

        status: ORDER_INVENTORY_STATUSES.RELEASED,

        /*
         * No quantity remains actively reserved
         * after cancellation.
         */
        reservedQuantity: 0,

        committedQuantity: 0,

        /*
         * Complete reserved quantity was released.
         */
        releasedQuantity: normalizedItem.quantity,
      },
    };
  });
};

/*
|--------------------------------------------------------------------------
| Build Committed Order Items
|--------------------------------------------------------------------------
*/

const buildCommittedOrderItems = (orderItems) => {
  return orderItems.map((item) => {
    const normalizedItem = normalizeOrderSubdocument(item);

    return {
      ...normalizedItem,

      inventory: {
        ...normalizedItem.inventory,

        status: ORDER_INVENTORY_STATUSES.COMMITTED,

        /*
         * No quantity remains reserved after commit.
         */
        reservedQuantity: 0,

        /*
         * The complete Order-item quantity has been committed.
         */
        committedQuantity: normalizedItem.quantity,

        releasedQuantity: 0,
      },
    };
  });
};

/*
|--------------------------------------------------------------------------
| Build Confirmed Order State
|--------------------------------------------------------------------------
*/

const buildConfirmedOrderState = (
  order,
  { adminId, note, adminNote, confirmedAt = new Date() },
) => {
  const existingStatusHistory = (order.statusHistory ?? []).map(
    normalizeOrderSubdocument,
  );

  const confirmedState = {
    items: buildCommittedOrderItems(order.items),

    status: ORDER_STATUSES.CONFIRMED,

    inventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,

    statusHistory: [
      ...existingStatusHistory,

      {
        status: ORDER_STATUSES.CONFIRMED,

        note: note ?? "Order confirmed by admin",

        changedBy: adminId,

        changedAt: confirmedAt,
      },
    ],

    updatedBy: adminId,
  };

  /*
   * Do not erase an existing admin note when this request
   * does not provide a new one.
   */
  if (adminNote !== undefined) {
    confirmedState.adminNote = adminNote;
  }

  return confirmedState;
};

/*
|--------------------------------------------------------------------------
| Build Simple Admin Order Status State
|--------------------------------------------------------------------------
|
| Used only for transitions that do not require:
|
| - Inventory reservation
| - Inventory release
| - Inventory commit
| - Shipment creation
| - Payment refund
|--------------------------------------------------------------------------
*/

const buildSimpleAdminOrderStatusState = (
  order,
  { targetStatus, adminId, note, adminNote, changedAt = new Date() },
) => {
  const existingStatusHistory = (order.statusHistory ?? []).map(
    normalizeOrderSubdocument,
  );

  const nextState = {
    status: targetStatus,

    statusHistory: [
      ...existingStatusHistory,

      {
        status: targetStatus,

        note:
          note ??
          ADMIN_ORDER_STATUS_DEFAULT_NOTES[targetStatus] ??
          `Order status changed to ${targetStatus}`,

        changedBy: adminId,

        changedAt,
      },
    ],

    updatedBy: adminId,
  };

  /*
   * Do not erase an existing admin note when
   * no new adminNote is provided.
   */
  if (adminNote !== undefined) {
    nextState.adminNote = adminNote;
  }

  return nextState;
};

/*
|--------------------------------------------------------------------------
| Execute Simple Admin Order Status Update
|--------------------------------------------------------------------------
*/

const executeSimpleAdminOrderStatusUpdate = async ({
  orderId,
  adminId,
  statusData,
}) => {
  const session = await mongoose.startSession();

  try {
    let updatedOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Load Order
          |--------------------------------------------------------------------------
          */

        const order = await findAdminOrderForStatusUpdate(orderId, {
          session,
        });

        if (!order) {
          throw createAdminOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Validate Transition
          |--------------------------------------------------------------------------
          */

        const transitionPlan = getAdminOrderStatusTransitionPlan(
          order,
          statusData.status,
        );

        /*
          |--------------------------------------------------------------------------
          | Protect Dedicated Workflows
          |--------------------------------------------------------------------------
          */

        if (transitionPlan.requiresInventoryCommit) {
          /*
           * Confirmation must use confirmAdminOrder(),
           * which commits Product inventory.
           */
          throw createOrderInventoryCommitStateInvalidError({
            orderId: order._id,
          });
        }

        if (transitionPlan.requiresInventoryRelease) {
          throw createDedicatedCancellationWorkflowRequiredError();
        }

        if (transitionPlan.requiresShipment) {
          throw createDedicatedShipmentWorkflowRequiredError();
        }

        if (transitionPlan.requiresDelivery) {
          throw createDedicatedDeliveryWorkflowRequiredError();
        }

        if (transitionPlan.requiresRefund) {
          throw createDedicatedRefundWorkflowRequiredError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Status State
          |--------------------------------------------------------------------------
          */

        const nextState = buildSimpleAdminOrderStatusState(order, {
          targetStatus: statusData.status,

          adminId,

          note: statusData.note,

          adminNote: statusData.adminNote,
        });

        order.set(nextState);

        /*
          |--------------------------------------------------------------------------
          | Save Order
          |--------------------------------------------------------------------------
          */

        updatedOrder = await saveOrderDocument(order, {
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

    return updatedOrder;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Order Confirmation
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderConfirmation = async ({
  orderId,
  adminId,
  statusData,
}) => {
  const session = await mongoose.startSession();

  try {
    let confirmedOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Load Order
          |--------------------------------------------------------------------------
          */

        const order = await findAdminOrderForStatusUpdate(orderId, {
          session,
        });

        if (!order) {
          throw createAdminOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Validate Transition
          |--------------------------------------------------------------------------
          */

        const transitionPlan = getAdminOrderStatusTransitionPlan(
          order,
          statusData.status,
        );

        if (!transitionPlan.requiresInventoryCommit) {
          throw createOrderInventoryCommitStateInvalidError({
            orderId: order._id,
          });
        }

        /*
          |--------------------------------------------------------------------------
          | Commit Product Inventory and Write Ledgers
          |--------------------------------------------------------------------------
          */

        await commitOrderItemsInventoryInTransaction(order, {
          actorUserId: adminId,

          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Build Confirmed Order State
          |--------------------------------------------------------------------------
          */

        const confirmedState = buildConfirmedOrderState(order, {
          adminId,

          note: statusData.note,

          adminNote: statusData.adminNote,
        });

        order.set(confirmedState);

        /*
          |--------------------------------------------------------------------------
          | Save Order
          |--------------------------------------------------------------------------
          */

        confirmedOrder = await saveOrderDocument(order, {
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

    return confirmedOrder;
  } finally {
    await session.endSession();
  }
};
/*
|--------------------------------------------------------------------------
| Build Customer Cancelled Order State
|--------------------------------------------------------------------------
|
| This function does not write to MongoDB.
|
| It prepares the trusted Order state that will be persisted
| after every Product reservation has been released.
|--------------------------------------------------------------------------
*/

export const buildCustomerCancelledOrderState = (
  order,
  { reason, customerId, cancelledAt = new Date() },
) => {
  assertCustomerOrderCanBeCancelled(order);

  const existingStatusHistory = (order.statusHistory ?? []).map(
    normalizeOrderSubdocument,
  );

  return {
    items: buildReleasedOrderItems(order.items),

    status: ORDER_STATUSES.CANCELLED,

    inventoryStatus: ORDER_INVENTORY_STATUSES.RELEASED,

    cancellation: {
      reason,

      cancelledBy: customerId,

      cancelledAt,
    },

    statusHistory: [
      ...existingStatusHistory,

      {
        status: ORDER_STATUSES.CANCELLED,

        note: "Order cancelled by customer",

        changedBy: customerId,

        changedAt: cancelledAt,
      },
    ],

    updatedBy: customerId,
  };
};

/*
|--------------------------------------------------------------------------
| Release Order Items Inventory in Transaction
|--------------------------------------------------------------------------
|
| The caller owns the transaction.
|
| Do not create or commit another transaction here.
|--------------------------------------------------------------------------
*/

export const releaseOrderItemsInventoryInTransaction = async (
  order,
  { actorUserId, session },
) => {
  requireActiveOrderTransaction(session);

  if (!actorUserId) {
    throw new Error("Order inventory release requires an actor user ID");
  }

  /*
   * The validation confirms that every item has a complete
   * active reservation before database mutations begin.
   */
  assertCustomerOrderCanBeCancelled(order);

  for (const orderItem of order.items) {
    const productId = orderItem.product;

    const variantId = orderItem.variantId;

    const releaseQuantity = orderItem.inventory.reservedQuantity;

    /*
      |--------------------------------------------------------------------------
      | Atomic Reservation Release
      |--------------------------------------------------------------------------
      */

    const updatedProduct = await releaseOrderVariantStockAtomically({
      productId,
      variantId,

      quantity: releaseQuantity,

      actorUserId,

      session,
    });

    if (!updatedProduct) {
      await diagnoseFailedOrderReservationRelease({
        orderId: order._id,

        orderItemId: orderItem._id,

        productId,
        variantId,
        releaseQuantity,
        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Matching Release Ledger Entry
      |--------------------------------------------------------------------------
      */

    await createOrderReservationReleaseLedgerEntry({
      updatedProduct,
      variantId,

      quantity: releaseQuantity,

      orderNumber: order.orderNumber,

      actorUserId,

      session,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Customer Order Cancellation
|--------------------------------------------------------------------------
*/

const executeAtomicCustomerOrderCancellation = async ({
  orderId,
  customerId,
  reason,
}) => {
  const session = await mongoose.startSession();

  try {
    let cancelledOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Load Customer-Owned Order
          |--------------------------------------------------------------------------
          */

        const order = await findCustomerOrderForCancellation(
          orderId,
          customerId,
          {
            session,
          },
        );

        if (!order) {
          /*
           * The same response is used when:
           *
           * - The Order does not exist.
           * - The Order belongs to another customer.
           */
          throw createCustomerOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Validate Cancellation and Inventory State
          |--------------------------------------------------------------------------
          */

        assertCustomerOrderCanBeCancelled(order);

        /*
          |--------------------------------------------------------------------------
          | Release Product Reservations and Write Ledgers
          |--------------------------------------------------------------------------
          */

        await releaseOrderItemsInventoryInTransaction(order, {
          actorUserId: customerId,

          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Cancelled Order State
          |--------------------------------------------------------------------------
          */

        const cancelledState = buildCustomerCancelledOrderState(order, {
          reason,

          customerId,
        });

        /*
          |--------------------------------------------------------------------------
          | Update Order
          |--------------------------------------------------------------------------
          */

        order.set(cancelledState);

        cancelledOrder = await saveOrderDocument(order, {
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

    return cancelledOrder;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Cancel Customer Order
|--------------------------------------------------------------------------
*/

export const cancelCustomerOrder = async (
  orderId,
  customerId,
  cancellationData,
) => {
  if (!customerId) {
    throw new Error("Customer ID is required to cancel an Order");
  }

  const reason = cancellationData?.reason;

  if (!reason) {
    throw new Error("Cancellation reason is required");
  }

  return executeAtomicCustomerOrderCancellation({
    orderId,
    customerId,
    reason,
  });
};

/*
|--------------------------------------------------------------------------
| Commit Order Items Inventory in Transaction
|--------------------------------------------------------------------------
|
| The caller owns the MongoDB transaction.
|--------------------------------------------------------------------------
*/

export const commitOrderItemsInventoryInTransaction = async (
  order,
  { actorUserId, session },
) => {
  requireActiveOrderTransaction(session);

  if (!actorUserId) {
    throw new Error("Order inventory commit requires an actor user ID");
  }

  /*
   * This validates:
   *
   * - Pending → confirmed is allowed.
   * - Payment state allows confirmation.
   * - Order inventory is fully reserved.
   */
  const transitionPlan = getAdminOrderStatusTransitionPlan(
    order,
    ORDER_STATUSES.CONFIRMED,
  );

  if (!transitionPlan.requiresInventoryCommit) {
    throw createOrderInventoryCommitStateInvalidError({
      orderId: order._id,
    });
  }

  for (const orderItem of order.items) {
    const productId = orderItem.product;

    const variantId = orderItem.variantId;

    const commitQuantity = orderItem.inventory.reservedQuantity;

    const updatedProduct = await commitOrderVariantStockAtomically({
      productId,
      variantId,

      quantity: commitQuantity,

      actorUserId,

      session,
    });

    if (!updatedProduct) {
      await diagnoseFailedOrderInventoryCommit({
        orderId: order._id,

        orderItemId: orderItem._id,

        productId,
        variantId,
        commitQuantity,
        session,
      });
    }

    await createOrderInventoryCommitLedgerEntry({
      updatedProduct,
      variantId,

      quantity: commitQuantity,

      orderNumber: order.orderNumber,

      actorUserId,

      session,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Confirm Admin Order
|--------------------------------------------------------------------------
*/

export const confirmAdminOrder = async (orderId, adminId, statusData) => {
  if (!adminId) {
    throw new Error("Admin ID is required to confirm an Order");
  }

  if (statusData?.status !== ORDER_STATUSES.CONFIRMED) {
    throw new Error("Admin Order confirmation requires confirmed status");
  }

  return executeAtomicAdminOrderConfirmation({
    orderId,
    adminId,
    statusData,
  });
};

/*
|--------------------------------------------------------------------------
| Update Admin Order Status
|--------------------------------------------------------------------------
|
| Dispatches status changes to the correct business workflow.
|--------------------------------------------------------------------------
*/

export const updateAdminOrderStatus = async (orderId, adminId, statusData) => {
  if (!adminId) {
    throw new Error("Admin ID is required to update an Order status");
  }

  const targetStatus = statusData?.status;

  if (!targetStatus) {
    throw new Error("Target Order status is required");
  }

  /*
    |--------------------------------------------------------------------------
    | Pending → Confirmed
    |--------------------------------------------------------------------------
    |
    | Confirmation commits:
    |
    | - Product physical stock
    | - Product reserved stock
    | - Order item inventory state
    | - Inventory Ledger entries
    |--------------------------------------------------------------------------
    */

  if (targetStatus === ORDER_STATUSES.CONFIRMED) {
    return confirmAdminOrder(orderId, adminId, statusData);
  }

  /*
    |--------------------------------------------------------------------------
    | Other Allowed Simple Transitions
    |--------------------------------------------------------------------------
    |
    | Currently:
    |
    | confirmed → processing
    | shipped   → delivered
    |--------------------------------------------------------------------------
    */

  return executeSimpleAdminOrderStatusUpdate({
    orderId,
    adminId,
    statusData,
  });
};

/*
|--------------------------------------------------------------------------
| Assert Admin Order Can Be Shipped
|--------------------------------------------------------------------------
*/

export const assertAdminOrderCanBeShipped = (order) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Shipment Protection
    |--------------------------------------------------------------------------
    */

  if (orderHasShipmentInformation(order)) {
    throw createOrderShipmentAlreadyCreatedError(order);
  }

  /*
    |--------------------------------------------------------------------------
    | Status Transition
    |--------------------------------------------------------------------------
    */

  if (order.status !== ORDER_STATUSES.PROCESSING) {
    throw createOrderShipmentStatusInvalidError(order.status);
  }

  const transitionPlan = getAdminOrderStatusTransitionPlan(
    order,
    ORDER_STATUSES.SHIPPED,
  );

  if (!transitionPlan.requiresShipment) {
    throw createOrderShipmentStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Inventory Must Already Be Committed
    |--------------------------------------------------------------------------
    */

  assertOrderItemsAreFullyCommitted(order);

  /*
    |--------------------------------------------------------------------------
    | Payment Must Allow Dispatch
    |--------------------------------------------------------------------------
    */

  assertOrderPaymentAllowsShipment(order);

  return transitionPlan;
};

/*
|--------------------------------------------------------------------------
| Build Admin Shipped Order State
|--------------------------------------------------------------------------
|
| This function does not write to MongoDB.
|
| It prepares the trusted state that will be persisted
| by the shipment transaction in the next part.
|--------------------------------------------------------------------------
*/

export const buildAdminShippedOrderState = (
  order,
  { shipmentData, adminId, shippedAt = new Date() },
) => {
  assertAdminOrderCanBeShipped(order);

  const existingStatusHistory = (order.statusHistory ?? []).map(
    normalizeOrderSubdocument,
  );

  const shippedState = {
    shipment: {
      carrier: shipmentData.carrier,

      trackingNumber: shipmentData.trackingNumber,

      trackingUrl: shipmentData.trackingUrl ?? null,

      shippedAt,

      deliveredAt: null,
    },

    status: ORDER_STATUSES.SHIPPED,

    /*
     * Product stock was already committed during confirmation.
     * Shipping does not modify inventory again.
     */
    inventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,

    statusHistory: [
      ...existingStatusHistory,

      {
        status: ORDER_STATUSES.SHIPPED,

        note: shipmentData.note ?? "Order shipped by admin",

        changedBy: adminId,

        changedAt: shippedAt,
      },
    ],

    updatedBy: adminId,
  };

  if (shipmentData.adminNote !== undefined) {
    shippedState.adminNote = shipmentData.adminNote;
  }

  return shippedState;
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Order Shipment
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderShipment = async ({
  orderId,
  adminId,
  shipmentData,
}) => {
  const session = await mongoose.startSession();

  try {
    let shippedOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Load Order
          |--------------------------------------------------------------------------
          */

        const order = await findAdminOrderForStatusUpdate(orderId, {
          session,
        });

        if (!order) {
          throw createAdminOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Shipment State
          |--------------------------------------------------------------------------
          |
          | This validates:
          |
          | - Order status is processing
          | - Shipment does not already exist
          | - Inventory is fully committed
          | - Payment state allows shipment
          |--------------------------------------------------------------------------
          */

        const shippedState = buildAdminShippedOrderState(order, {
          shipmentData,
          adminId,
        });

        /*
          |--------------------------------------------------------------------------
          | Apply Shipment State
          |--------------------------------------------------------------------------
          */

        order.set(shippedState);

        /*
          |--------------------------------------------------------------------------
          | Save Order
          |--------------------------------------------------------------------------
          */

        shippedOrder = await saveOrderDocument(order, {
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

    return shippedOrder;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Ship Admin Order
|--------------------------------------------------------------------------
*/

export const shipAdminOrder = async (orderId, adminId, shipmentData) => {
  if (!adminId) {
    throw new Error("Admin ID is required to ship an Order");
  }

  if (!shipmentData) {
    throw new Error("Shipment data is required");
  }

  return executeAtomicAdminOrderShipment({
    orderId,
    adminId,
    shipmentData,
  });
};

/*
|--------------------------------------------------------------------------
| Get Delivery Payment Plan
|--------------------------------------------------------------------------
|
| Cash on delivery:
|
| pending → paid during delivery
| paid    → remain paid
|
| Online:
|
| must already be paid
|--------------------------------------------------------------------------
*/

export const getAdminOrderDeliveryPaymentPlan = (order) => {
  const paymentMethod = order.payment?.method;

  const paymentStatus = order.payment?.status;

  /*
    |--------------------------------------------------------------------------
    | Cash on Delivery — Pending
    |--------------------------------------------------------------------------
    */

  if (
    paymentMethod === ORDER_PAYMENT_METHODS.CASH_ON_DELIVERY &&
    paymentStatus === ORDER_PAYMENT_STATUSES.PENDING
  ) {
    return {
      paymentMethod,
      currentPaymentStatus: paymentStatus,

      targetPaymentStatus: ORDER_PAYMENT_STATUSES.PAID,

      shouldMarkPaymentPaid: true,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Cash on Delivery — Already Paid
    |--------------------------------------------------------------------------
    */

  if (
    paymentMethod === ORDER_PAYMENT_METHODS.CASH_ON_DELIVERY &&
    paymentStatus === ORDER_PAYMENT_STATUSES.PAID
  ) {
    return {
      paymentMethod,
      currentPaymentStatus: paymentStatus,

      targetPaymentStatus: paymentStatus,

      shouldMarkPaymentPaid: false,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Online Payment
    |--------------------------------------------------------------------------
    */

  if (
    paymentMethod === ORDER_PAYMENT_METHODS.ONLINE &&
    paymentStatus === ORDER_PAYMENT_STATUSES.PAID
  ) {
    return {
      paymentMethod,
      currentPaymentStatus: paymentStatus,

      targetPaymentStatus: paymentStatus,

      shouldMarkPaymentPaid: false,
    };
  }

  throw createOrderDeliveryPaymentStateInvalidError(
    paymentMethod,
    paymentStatus,
  );
};

/*
|--------------------------------------------------------------------------
| Assert Admin Order Can Be Delivered
|--------------------------------------------------------------------------
*/

export const assertAdminOrderCanBeDelivered = (order) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Delivery Protection
    |--------------------------------------------------------------------------
    */

  if (orderHasCompletedDelivery(order)) {
    throw createOrderAlreadyDeliveredError(order);
  }

  /*
    |--------------------------------------------------------------------------
    | Current Status
    |--------------------------------------------------------------------------
    */

  if (order.status !== ORDER_STATUSES.SHIPPED) {
    throw createOrderDeliveryStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Transition Plan
    |--------------------------------------------------------------------------
    */

  const transitionPlan = getAdminOrderStatusTransitionPlan(
    order,
    ORDER_STATUSES.DELIVERED,
  );

  if (!transitionPlan.requiresDelivery) {
    throw createOrderDeliveryStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Shipment State
    |--------------------------------------------------------------------------
    */

  assertOrderShipmentIsReadyForDelivery(order);

  /*
    |--------------------------------------------------------------------------
    | Inventory State
    |--------------------------------------------------------------------------
    */

  assertOrderInventoryRemainsCommittedForDelivery(order);

  /*
    |--------------------------------------------------------------------------
    | Payment State
    |--------------------------------------------------------------------------
    */

  const paymentPlan = getAdminOrderDeliveryPaymentPlan(order);

  return {
    transitionPlan,
    paymentPlan,
  };
};

/*
|--------------------------------------------------------------------------
| Build Admin Delivered Order State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminDeliveredOrderState = (
  order,
  { deliveryData, adminId, deliveredAt = new Date() },
) => {
  const { paymentPlan } = assertAdminOrderCanBeDelivered(order);

  const existingShipment = normalizeOrderSubdocument(order.shipment);

  const existingPayment = normalizeOrderSubdocument(order.payment);

  const existingStatusHistory = (order.statusHistory ?? []).map(
    normalizeOrderSubdocument,
  );

  const deliveredState = {
    status: ORDER_STATUSES.DELIVERED,

    inventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,

    shipment: {
      ...existingShipment,

      deliveredAt,
    },

    statusHistory: [
      ...existingStatusHistory,

      {
        status: ORDER_STATUSES.DELIVERED,

        note: deliveryData.note ?? "Order delivered",

        changedBy: adminId,

        changedAt: deliveredAt,
      },
    ],

    updatedBy: adminId,
  };

  /*
    |--------------------------------------------------------------------------
    | Complete Cash-on-Delivery Payment
    |--------------------------------------------------------------------------
    */

  if (paymentPlan.shouldMarkPaymentPaid) {
    deliveredState.payment = {
      ...existingPayment,

      status: ORDER_PAYMENT_STATUSES.PAID,

      paidAt: existingPayment.paidAt ?? deliveredAt,

      failedAt: null,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Preserve Existing Admin Note
    |--------------------------------------------------------------------------
    */

  if (deliveryData.adminNote !== undefined) {
    deliveredState.adminNote = deliveryData.adminNote;
  }

  return deliveredState;
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Order Delivery
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderDelivery = async ({
  orderId,
  adminId,
  deliveryData,
}) => {
  const session = await mongoose.startSession();

  try {
    let deliveredOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Load Order
          |--------------------------------------------------------------------------
          */

        const order = await findAdminOrderForStatusUpdate(orderId, {
          session,
        });

        if (!order) {
          throw createAdminOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Delivery State
          |--------------------------------------------------------------------------
          |
          | This validates:
          |
          | - Order is currently shipped
          | - Delivery was not already completed
          | - Valid shipment information exists
          | - Order inventory remains committed
          | - Payment state permits delivery
          |--------------------------------------------------------------------------
          */

        const deliveredState = buildAdminDeliveredOrderState(order, {
          deliveryData,
          adminId,
        });

        /*
          |--------------------------------------------------------------------------
          | Apply Delivery State
          |--------------------------------------------------------------------------
          */

        order.set(deliveredState);

        /*
          |--------------------------------------------------------------------------
          | Save Order
          |--------------------------------------------------------------------------
          */

        deliveredOrder = await saveOrderDocument(order, {
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

    return deliveredOrder;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Deliver Admin Order
|--------------------------------------------------------------------------
*/

export const deliverAdminOrder = async (
  orderId,
  adminId,
  deliveryData = {},
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to deliver an Order");
  }

  return executeAtomicAdminOrderDelivery({
    orderId,
    adminId,

    deliveryData: deliveryData ?? {},
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Order Refund Payment Plan
|--------------------------------------------------------------------------
|
| Both online and cash-on-delivery Orders must currently be paid.
|
| This workflow records a completed full refund.
|--------------------------------------------------------------------------
*/

export const getAdminOrderRefundPaymentPlan = (order) => {
  const paymentMethod = order.payment?.method;

  const paymentStatus = order.payment?.status;

  if (paymentStatus !== ORDER_PAYMENT_STATUSES.PAID) {
    throw createOrderRefundPaymentStateInvalidError(
      paymentMethod,
      paymentStatus,
    );
  }

  const grandTotal = order.totals?.grandTotal;

  const currency = order.totals?.currency;

  const validGrandTotal =
    typeof grandTotal === "number" &&
    Number.isFinite(grandTotal) &&
    grandTotal > 0;

  if (!validGrandTotal || !currency) {
    throw createOrderRefundTotalInvalidError(grandTotal, currency);
  }

  return {
    paymentMethod,

    currentPaymentStatus: paymentStatus,

    targetPaymentStatus: ORDER_PAYMENT_STATUSES.REFUNDED,

    refundAmount: grandTotal,

    currency,

    preservePaidAt: true,
  };
};

/*
|--------------------------------------------------------------------------
| Assert Admin Order Can Be Refunded
|--------------------------------------------------------------------------
*/

export const assertAdminOrderCanBeRefunded = (order) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Refund Protection
    |--------------------------------------------------------------------------
    */

  if (orderHasCompletedRefund(order)) {
    throw createOrderAlreadyRefundedError(order);
  }

  /*
    |--------------------------------------------------------------------------
    | Current Order Status
    |--------------------------------------------------------------------------
    */

  if (order.status !== ORDER_STATUSES.DELIVERED) {
    throw createOrderRefundStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Transition Plan
    |--------------------------------------------------------------------------
    */

  const transitionPlan = getAdminOrderStatusTransitionPlan(
    order,
    ORDER_STATUSES.REFUNDED,
  );

  if (!transitionPlan.requiresRefund) {
    throw createOrderRefundStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Delivery State
    |--------------------------------------------------------------------------
    */

  assertOrderDeliveryCompletedForRefund(order);

  /*
    |--------------------------------------------------------------------------
    | Inventory Snapshot
    |--------------------------------------------------------------------------
    */

  assertOrderInventoryRemainsCommittedForRefund(order);

  /*
    |--------------------------------------------------------------------------
    | Payment State and Refund Amount
    |--------------------------------------------------------------------------
    */

  const paymentPlan = getAdminOrderRefundPaymentPlan(order);

  return {
    transitionPlan,
    paymentPlan,
  };
};

/*
|--------------------------------------------------------------------------
| Build Admin Refunded Order State
|--------------------------------------------------------------------------
|
| This prepares the trusted state only.
| Database persistence is added in the next part.
|--------------------------------------------------------------------------
*/

export const buildAdminRefundedOrderState = (
  order,
  { refundData, adminId, refundedAt = new Date() },
) => {
  const { paymentPlan } = assertAdminOrderCanBeRefunded(order);

  const existingPayment = normalizeOrderSubdocument(order.payment);

  const existingStatusHistory = (order.statusHistory ?? []).map(
    normalizeOrderSubdocument,
  );

  const refundedState = {
    status: ORDER_STATUSES.REFUNDED,

    /*
     * Refunding payment does not automatically restock goods.
     */
    inventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,

    payment: {
      ...existingPayment,

      status: ORDER_PAYMENT_STATUSES.REFUNDED,

      /*
       * Preserve when the original payment was completed.
       */
      paidAt: existingPayment.paidAt,

      refundedAt,

      failedAt: null,
    },

    refund: {
      reason: refundData.reason,

      referenceId: refundData.referenceId,

      amount: paymentPlan.refundAmount,

      currency: paymentPlan.currency,

      refundedBy: adminId,

      refundedAt,
    },

    statusHistory: [
      ...existingStatusHistory,

      {
        status: ORDER_STATUSES.REFUNDED,

        note: refundData.note ?? "Order payment fully refunded",

        changedBy: adminId,

        changedAt: refundedAt,
      },
    ],

    updatedBy: adminId,
  };

  if (refundData.adminNote !== undefined) {
    refundedState.adminNote = refundData.adminNote;
  }

  return refundedState;
};

/*
|--------------------------------------------------------------------------
| Build Order Refund Audit Data
|--------------------------------------------------------------------------
*/

const buildOrderRefundAuditData = (order, refundedState) => {
  return {
    order: order._id,

    orderNumber: order.orderNumber,

    customer: order.customer,

    paymentMethod: order.payment.method,

    previousPaymentStatus: order.payment.status,

    paymentStatus: refundedState.payment.status,

    amount: refundedState.refund.amount,

    currency: refundedState.refund.currency,

    reason: refundedState.refund.reason,

    referenceId: refundedState.refund.referenceId,

    refundedBy: refundedState.refund.refundedBy,

    refundedAt: refundedState.refund.refundedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Order Refund
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderRefund = async ({
  orderId,
  adminId,
  refundData,
}) => {
  const session = await mongoose.startSession();

  try {
    let refundedOrder;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Load Order
          |--------------------------------------------------------------------------
          */

        const order = await findAdminOrderForStatusUpdate(orderId, {
          session,
        });

        if (!order) {
          throw createAdminOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Generate One Shared Refund Timestamp
          |--------------------------------------------------------------------------
          */

        const refundedAt = new Date();

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Refunded State
          |--------------------------------------------------------------------------
          |
          | This validates:
          |
          | - Order status is delivered
          | - Delivery has completed
          | - Inventory remains committed
          | - Payment is paid
          | - Order has not already been refunded
          | - Grand total is refundable
          |--------------------------------------------------------------------------
          */

        const refundedState = buildAdminRefundedOrderState(order, {
          refundData,
          adminId,
          refundedAt,
        });

        /*
          |--------------------------------------------------------------------------
          | Create Immutable Financial Audit Record
          |--------------------------------------------------------------------------
          */

        const refundAuditData = buildOrderRefundAuditData(order, refundedState);

        await createOrderRefundAuditEntry(refundAuditData, {
          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Update Order
          |--------------------------------------------------------------------------
          */

        order.set(refundedState);

        refundedOrder = await saveOrderDocument(order, {
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

    return refundedOrder;
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }

    /*
     * The same external/manual refund reference
     * was already used.
     */
    if (error.keyPattern?.referenceId || error.keyValue?.referenceId) {
      throw createOrderRefundReferenceConflictError(refundData.referenceId);
    }

    /*
     * A concurrent request already created the
     * one-refund-per-Order audit record.
     */
    if (error.keyPattern?.order || error.keyValue?.order) {
      throw createConcurrentOrderRefundError(orderId);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Refund Admin Order
|--------------------------------------------------------------------------
*/

export const refundAdminOrder = async (orderId, adminId, refundData) => {
  if (!adminId) {
    throw new Error("Admin ID is required to refund an Order");
  }

  if (!refundData) {
    throw new Error("Refund data is required");
  }

  return executeAtomicAdminOrderRefund({
    orderId,
    adminId,
    refundData,
  });
};

/*
|--------------------------------------------------------------------------
| Prepare Customer Order Return Request
|--------------------------------------------------------------------------
|
| This function validates and builds trusted return data.
|
| It does not create the return-request document yet.
|--------------------------------------------------------------------------
*/

export const prepareCustomerOrderReturnRequest = async ({
  orderId,
  customerId,
  returnData,
  session = null,
}) => {
  if (!customerId) {
    throw new Error("Customer ID is required to create a return request");
  }

  /*
    |--------------------------------------------------------------------------
    | Load Customer-Owned Order
    |--------------------------------------------------------------------------
    */

  const order = await findCustomerOrderForReturnRequest(orderId, customerId, {
    session,
  });

  if (!order) {
    throw createCustomerReturnOrderNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Order Eligibility
    |--------------------------------------------------------------------------
    */

  assertCustomerOrderIsReturnEligible(order);

  const requestedOrderItemIds = returnData.items.map((item) => {
    return item.orderItemId;
  });

  /*
    |--------------------------------------------------------------------------
    | Calculate Previously Consumed Quantities
    |--------------------------------------------------------------------------
    */

  const consumedQuantities = await findConsumedOrderReturnQuantities({
    orderId: order._id,

    orderItemIds: requestedOrderItemIds,

    session,
  });

  /*
    |--------------------------------------------------------------------------
    | Build Trusted Return Items
    |--------------------------------------------------------------------------
    */

  const trustedItems = buildTrustedCustomerReturnItems({
    order,

    requestedItems: returnData.items,

    consumedQuantities,
  });

  /*
    |--------------------------------------------------------------------------
    | Build Return-Request Draft
    |--------------------------------------------------------------------------
    |
    | returnRequestNumber will be generated during persistence.
    |--------------------------------------------------------------------------
    */

  const returnRequestData = {
    order: order._id,

    orderNumber: order.orderNumber,

    customer: customerId,

    items: trustedItems,

    requestedResolution: returnData.requestedResolution,

    status: ORDER_RETURN_STATUSES.REQUESTED,

    customerNote: returnData.customerNote ?? null,

    adminNote: null,

    createdBy: customerId,

    updatedBy: customerId,
  };

  return {
    order,
    returnRequestData,
  };
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Customer Return Request
|--------------------------------------------------------------------------
*/

const executeAtomicCustomerOrderReturnRequest = async ({
  orderId,
  customerId,
  returnData,
}) => {
  const session = await mongoose.startSession();

  try {
    let createdReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Create Shared Order Write Boundary
          |--------------------------------------------------------------------------
          |
          | Concurrent return requests for the same Order must update the same
          | document before calculating consumed quantities.
          |--------------------------------------------------------------------------
          */

        const orderMatched = await bumpOrderReturnRequestVersion(
          orderId,
          customerId,
          {
            session,
          },
        );

        if (!orderMatched) {
          throw createCustomerReturnOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Validate and Build Trusted Return Data
          |--------------------------------------------------------------------------
          |
          | Because the version write happened first, a retried transaction
          | will observe the latest committed return-request quantities.
          |--------------------------------------------------------------------------
          */

        const { returnRequestData } = await prepareCustomerOrderReturnRequest({
          orderId,
          customerId,
          returnData,
          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Generate Return Request Number
          |--------------------------------------------------------------------------
          */

        const returnRequestNumber = await generateUniqueReturnRequestNumber({
          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Create Return Request
          |--------------------------------------------------------------------------
          */

        createdReturnRequest = await createOrderReturnRequestDocument(
          {
            ...returnRequestData,

            returnRequestNumber,
          },
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

    return createdReturnRequest;
  } catch (error) {
    if (
      isMongoDuplicateKeyError(error) &&
      (error.keyPattern?.returnRequestNumber ||
        error.keyValue?.returnRequestNumber)
    ) {
      throw createCustomerReturnNumberConflictError();
    }

    if (isOrderReturnTransactionConflict(error)) {
      throw createCustomerReturnConcurrencyError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Create Customer Order Return Request
|--------------------------------------------------------------------------
*/

export const createCustomerOrderReturnRequest = async (
  orderId,
  customerId,
  returnData,
) => {
  if (!customerId) {
    throw new Error("Customer ID is required to create a return request");
  }

  if (!returnData) {
    throw new Error("Return request data is required");
  }

  return executeAtomicCustomerOrderReturnRequest({
    orderId,
    customerId,
    returnData,
  });
};

/*
|--------------------------------------------------------------------------
| Assert Customer Return Request Can Be Cancelled
|--------------------------------------------------------------------------
*/

export const assertCustomerOrderReturnCanBeCancelled = (returnRequest) => {
  /*
    |--------------------------------------------------------------------------
    | Duplicate Cancellation
    |--------------------------------------------------------------------------
    */

  if (orderReturnRequestIsAlreadyCancelled(returnRequest)) {
    throw createCustomerReturnAlreadyCancelledError(returnRequest);
  }

  /*
    |--------------------------------------------------------------------------
    | Allowed Status
    |--------------------------------------------------------------------------
    */

  if (
    !CUSTOMER_CANCELLABLE_ORDER_RETURN_STATUS_VALUES.includes(
      returnRequest.status,
    )
  ) {
    throw createCustomerReturnCancellationStatusInvalidError(
      returnRequest.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Physical Processing Must Not Have Started
    |--------------------------------------------------------------------------
    */

  if (orderReturnPhysicalProcessingHasStarted(returnRequest)) {
    throw createCustomerReturnCancellationStateInvalidError(
      returnRequest.status,
    );
  }

  return {
    currentStatus: returnRequest.status,

    targetStatus: ORDER_RETURN_STATUSES.CANCELLED,
  };
};

/*
|--------------------------------------------------------------------------
| Build Customer Cancelled Return Request State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildCustomerCancelledOrderReturnState = (
  returnRequest,
  { cancellationData, customerId, cancelledAt = new Date() },
) => {
  assertCustomerOrderReturnCanBeCancelled(returnRequest);

  return {
    status: ORDER_RETURN_STATUSES.CANCELLED,

    cancellation: {
      reason: cancellationData.reason,

      cancelledBy: customerId,

      cancelledAt,
    },

    updatedBy: customerId,
  };
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Customer Return Cancellation
|--------------------------------------------------------------------------
*/

const executeAtomicCustomerOrderReturnCancellation = async ({
  returnRequestId,
  customerId,
  cancellationData,
}) => {
  const session = await mongoose.startSession();

  try {
    let cancelledReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Load Customer-Owned Return Request
          |--------------------------------------------------------------------------
          */

        const returnRequest =
          await findCustomerOrderReturnRequestForCancellation(
            returnRequestId,
            customerId,
            {
              session,
            },
          );

        if (!returnRequest) {
          throw createCustomerReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Validate and Build Trusted Cancellation State
          |--------------------------------------------------------------------------
          */

        const cancelledAt = new Date();

        const cancelledState = buildCustomerCancelledOrderReturnState(
          returnRequest,
          {
            cancellationData,
            customerId,
            cancelledAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Synchronize Return Quantity State
          |--------------------------------------------------------------------------
          |
          | Cancellation releases previously consumed return quantity.
          |
          | Updating the Order returnRequestVersion creates a shared write
          | boundary with concurrent return-request creation transactions.
          |--------------------------------------------------------------------------
          */

        const orderMatched = await bumpOrderReturnRequestVersion(
          returnRequest.order,
          customerId,
          {
            session,
          },
        );

        if (!orderMatched) {
          throw createCustomerReturnOrderStateInvalidError(returnRequest.order);
        }

        /*
          |--------------------------------------------------------------------------
          | Apply Cancellation
          |--------------------------------------------------------------------------
          */

        returnRequest.set(cancelledState);

        /*
          |--------------------------------------------------------------------------
          | Save Return Request
          |--------------------------------------------------------------------------
          */

        cancelledReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return cancelledReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createCustomerReturnConcurrencyError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Cancel Customer Order Return Request
|--------------------------------------------------------------------------
*/

export const cancelCustomerOrderReturnRequest = async (
  returnRequestId,
  customerId,
  cancellationData,
) => {
  if (!customerId) {
    throw new Error("Customer ID is required to cancel a return request");
  }

  if (!cancellationData) {
    throw new Error("Return cancellation data is required");
  }

  return executeAtomicCustomerOrderReturnCancellation({
    returnRequestId,
    customerId,
    cancellationData,
  });
};

/*
|--------------------------------------------------------------------------
| Build Admin Approved Return Request State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminApprovedOrderReturnState = (
  returnRequest,
  {
    approvalData = {},

    adminId,

    approvedAt = new Date(),
  },
) => {
  assertAdminOrderReturnCanBeApproved(returnRequest);

  const approvedState = {
    status: ORDER_RETURN_STATUSES.APPROVED,

    approval: {
      approvedBy: adminId,

      approvedAt,
    },

    updatedBy: adminId,
  };

  if (approvalData.adminNote !== undefined) {
    approvedState.adminNote = approvalData.adminNote;
  }

  return approvedState;
};

/*
|--------------------------------------------------------------------------
| Build Admin Rejected Return Request State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminRejectedOrderReturnState = (
  returnRequest,
  { rejectionData, adminId, rejectedAt = new Date() },
) => {
  assertAdminOrderReturnCanBeRejected(returnRequest);

  const rejectedState = {
    status: ORDER_RETURN_STATUSES.REJECTED,

    rejection: {
      reason: rejectionData.reason,

      rejectedBy: adminId,

      rejectedAt,
    },

    updatedBy: adminId,
  };

  if (rejectionData.adminNote !== undefined) {
    rejectedState.adminNote = rejectionData.adminNote;
  }

  return rejectedState;
};

/*
|--------------------------------------------------------------------------
| Approve Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const approveAdminOrderReturnRequest = async (
  returnRequestId,
  adminId,
  approvalData = {},
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to approve a Return Request");
  }

  return executeAtomicAdminOrderReturnApproval({
    returnRequestId,
    adminId,
    approvalData,
  });
};

/*
|--------------------------------------------------------------------------
| Reject Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const rejectAdminOrderReturnRequest = async (
  returnRequestId,
  adminId,
  rejectionData,
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to reject a Return Request");
  }

  if (!rejectionData) {
    throw new Error("Return rejection data is required");
  }

  return executeAtomicAdminOrderReturnRejection({
    returnRequestId,
    adminId,
    rejectionData,
  });
};

/*
|--------------------------------------------------------------------------
| Build Admin In-Transit Return State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminOrderReturnInTransitState = (
  returnRequest,
  { shipmentData, adminId, markedInTransitAt = new Date() },
) => {
  assertAdminOrderReturnCanBeMarkedInTransit(returnRequest);

  return {
    status: ORDER_RETURN_STATUSES.IN_TRANSIT,

    shipment: {
      carrier: shipmentData.carrier,

      trackingNumber: shipmentData.trackingNumber,

      trackingUrl: shipmentData.trackingUrl ?? null,

      note: shipmentData.note ?? null,

      markedInTransitBy: adminId,

      markedInTransitAt,
    },

    updatedBy: adminId,
  };
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Return Mark-In-Transit
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnMarkInTransit = async ({
  returnRequestId,
  adminId,
  shipmentData,
}) => {
  const session = await mongoose.startSession();

  try {
    let inTransitReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

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
          throw createAdminOrderReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Shipment State
          |--------------------------------------------------------------------------
          */

        const markedInTransitAt = new Date();

        const inTransitState = buildAdminOrderReturnInTransitState(
          returnRequest,
          {
            shipmentData,
            adminId,
            markedInTransitAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Apply Shipment State
          |--------------------------------------------------------------------------
          */

        returnRequest.set(inTransitState);

        /*
          |--------------------------------------------------------------------------
          | Save Return Request
          |--------------------------------------------------------------------------
          */

        inTransitReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return inTransitReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnProcessingConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Return Warehouse Receipt
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnReceipt = async ({
  returnRequestId,
  adminId,
  receiptData,
}) => {
  const session = await mongoose.startSession();

  try {
    let receivedReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

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
          throw createAdminOrderReturnRequestNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Receipt State
          |--------------------------------------------------------------------------
          */

        const receivedAt = new Date();

        const receivedState = buildAdminOrderReturnReceivedState(
          returnRequest,
          {
            receiptData,
            adminId,
            receivedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Apply Receipt State
          |--------------------------------------------------------------------------
          */

        returnRequest.set(receivedState);

        /*
          |--------------------------------------------------------------------------
          | Save Return Request
          |--------------------------------------------------------------------------
          */

        receivedReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return receivedReturnRequest;
  } catch (error) {
    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnProcessingConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Build Admin Received Return State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminOrderReturnReceivedState = (
  returnRequest,
  {
    receiptData = {},

    adminId,

    receivedAt = new Date(),
  },
) => {
  assertAdminOrderReturnCanBeReceived(returnRequest);

  return {
    status: ORDER_RETURN_STATUSES.RECEIVED,

    receipt: {
      note: receiptData.note ?? null,

      receivedBy: adminId,

      receivedAt,
    },

    updatedBy: adminId,
  };
};

/*
|--------------------------------------------------------------------------
| Mark Admin Order Return Request In Transit
|--------------------------------------------------------------------------
*/

export const markAdminOrderReturnRequestInTransit = async (
  returnRequestId,
  adminId,
  shipmentData,
) => {
  if (!adminId) {
    throw new Error(
      "Admin ID is required to mark a Return Request as in transit",
    );
  }

  if (!shipmentData) {
    throw new Error("Return shipment data is required");
  }

  return executeAtomicAdminOrderReturnMarkInTransit({
    returnRequestId,
    adminId,
    shipmentData,
  });
};

/*
|--------------------------------------------------------------------------
| Receive Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const receiveAdminOrderReturnRequest = async (
  returnRequestId,
  adminId,
  receiptData = {},
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to receive a Return Request");
  }

  return executeAtomicAdminOrderReturnReceipt({
    returnRequestId,
    adminId,
    receiptData,
  });
};

/*
|--------------------------------------------------------------------------
| Build Admin Inspected Return Request State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminOrderReturnInspectedState = (
  returnRequest,
  { inspectionData, adminId, inspectedAt = new Date() },
) => {
  assertAdminOrderReturnCanBeInspected(returnRequest);

  const trustedInspectionItems = buildTrustedAdminOrderReturnInspectionItems(
    returnRequest,
    inspectionData.items,
    {
      adminId,
      inspectedAt,
    },
  );

  /*
    |--------------------------------------------------------------------------
    | Preserve Immutable Return Item Snapshot
    |--------------------------------------------------------------------------
    */

  const inspectionByOrderItemId = new Map(
    trustedInspectionItems.map((item) => [item.orderItemId, item.inspection]),
  );

  const items = returnRequest.items.map((trustedReturnItem) => {
    const inspection = inspectionByOrderItemId.get(
      String(trustedReturnItem.orderItemId),
    );

    return {
      orderItemId: trustedReturnItem.orderItemId,

      product: trustedReturnItem.product,

      variantId: trustedReturnItem.variantId,

      sku: trustedReturnItem.sku,

      productName: trustedReturnItem.productName,

      size: trustedReturnItem.size,

      color: trustedReturnItem.color,

      quantity: trustedReturnItem.quantity,

      reason: trustedReturnItem.reason,

      details: trustedReturnItem.details,

      inspection,
    };
  });

  return {
    status: ORDER_RETURN_STATUSES.INSPECTED,

    items,

    updatedBy: adminId,
  };
};

/*
|--------------------------------------------------------------------------
| Apply Trusted Admin Return Inspection State
|--------------------------------------------------------------------------
|
| Only mutable inspection fields are changed.
|
| The original Return-item snapshot and subdocument IDs are preserved.
|--------------------------------------------------------------------------
*/

const applyAdminOrderReturnInspectedState = (returnRequest, inspectedState) => {
  const inspectionByOrderItemId = new Map(
    (inspectedState.items ?? []).map((item) => [
      String(item.orderItemId),

      item.inspection,
    ]),
  );

  for (const returnItem of returnRequest.items) {
    const orderItemId = String(returnItem.orderItemId);

    const inspection = inspectionByOrderItemId.get(orderItemId);

    /*
     * buildAdminOrderReturnInspectedState() already validates
     * complete item coverage, so this should never happen.
     */
    if (!inspection) {
      throw new Error(
        `Trusted inspection state is missing Order item ${orderItemId}`,
      );
    }

    returnItem.set("inspection", inspection);
  }

  returnRequest.set("status", inspectedState.status);

  returnRequest.set("updatedBy", inspectedState.updatedBy);

  return returnRequest;
};

/*
|--------------------------------------------------------------------------
| Inspect Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const inspectAdminOrderReturnRequest = async (
  returnRequestId,
  adminId,
  inspectionData,
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to inspect a Return Request");
  }

  if (!inspectionData) {
    throw new Error("Return inspection data is required");
  }

  return executeAtomicAdminOrderReturnInspection({
    returnRequestId,
    adminId,
    inspectionData,
  });
};

/*
|--------------------------------------------------------------------------
| Build Return Inventory Restoration Plan
|--------------------------------------------------------------------------
|
| Only resellable quantities are restored.
|
| Damaged and rejected quantities never enter normal sellable stock.
|--------------------------------------------------------------------------
*/

export const buildAdminOrderReturnInventoryRestorationPlan = (
  returnRequest,
) => {
  assertAdminOrderReturnCanBeCompleted(returnRequest);

  const restorationPlan = [];

  for (const returnItem of returnRequest.items) {
    const { resellableQuantity, damagedQuantity, rejectedQuantity } =
      assertOrderReturnItemInspectionIsComplete(returnItem);

    /*
      |--------------------------------------------------------------------------
      | Nothing to Restock
      |--------------------------------------------------------------------------
      */

    if (resellableQuantity === 0) {
      continue;
    }

    restorationPlan.push({
      orderItemId: returnItem.orderItemId,

      productId: returnItem.product,

      variantId: returnItem.variantId,

      sku: returnItem.sku,

      quantity: resellableQuantity,

      inspection: {
        resellableQuantity,

        damagedQuantity,

        rejectedQuantity,
      },
    });
  }

  return restorationPlan;
};

/*
|--------------------------------------------------------------------------
| Build Admin Completed Return Request State
|--------------------------------------------------------------------------
|
| This does NOT update Product inventory.
|
| Product restoration will be performed by the atomic completion transaction
| in the next part.
|--------------------------------------------------------------------------
*/

export const buildAdminCompletedOrderReturnState = (
  returnRequest,
  { completionData = {}, adminId, completedAt = new Date() },
) => {
  assertAdminOrderReturnCanBeCompleted(returnRequest);

  const completedState = {
    status: ORDER_RETURN_STATUSES.COMPLETED,

    completion: {
      completedBy: adminId,

      completedAt,
    },

    updatedBy: adminId,
  };

  if (completionData.adminNote !== undefined) {
    completedState.adminNote = completionData.adminNote;
  }

  return completedState;
};

/*
|--------------------------------------------------------------------------
| Restore Return Inventory In Existing Transaction
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| This function does NOT start or commit a transaction.
|
| The Return completion service owns the transaction.
|--------------------------------------------------------------------------
*/

export const restoreAdminOrderReturnInventoryInTransaction = async (
  restorationPlan,
  { returnRequestNumber, actorUserId, session },
) => {
  requireActiveOrderTransaction(session);

  if (!actorUserId) {
    throw new Error("Return inventory restoration requires an actor user ID");
  }

  if (!returnRequestNumber) {
    throw new Error(
      "Return inventory restoration requires a Return Request number",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | No Resellable Stock
    |--------------------------------------------------------------------------
    |
    | A fully damaged/rejected Return can still complete.
    |--------------------------------------------------------------------------
    */

  if (restorationPlan.length === 0) {
    return [];
  }

  const restoredVariants = [];

  /*
   * Do not use Promise.all().
   *
   * Operations using one MongoDB transaction session
   * should execute sequentially.
   */
  for (const restorationItem of restorationPlan) {
    const { productId, variantId, quantity } = restorationItem;

    /*
      |--------------------------------------------------------------------------
      | Atomic Positive Physical-Stock Adjustment
      |--------------------------------------------------------------------------
      */

    const updatedProduct = await adjustVariantStockAtomically({
      productId,
      variantId,

      quantityDelta: quantity,

      actorUserId,

      session,
    });

    if (!updatedProduct) {
      await diagnoseFailedAdminOrderReturnInventoryRestoration({
        productId,
        variantId,
        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Matching Inventory Ledger
      |--------------------------------------------------------------------------
      */

    const updatedVariant =
      await createOrderReturnInventoryRestorationLedgerEntry({
        updatedProduct,
        variantId,

        quantity,

        returnRequestNumber,

        actorUserId,

        session,
      });

    restoredVariants.push({
      productId: updatedProduct._id,

      variantId: updatedVariant._id,

      sku: updatedVariant.sku,

      restoredQuantity: quantity,
    });
  }

  return restoredVariants;
};

/*
|--------------------------------------------------------------------------
| Complete Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const completeAdminOrderReturnRequest = async (
  returnRequestId,
  adminId,
  completionData = {},
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to complete a Return Request");
  }

  return executeAtomicAdminOrderReturnCompletion({
    returnRequestId,
    adminId,

    completionData: completionData ?? {},
  });
};

/*
|--------------------------------------------------------------------------
| Build Admin Return Refund Plan
|--------------------------------------------------------------------------
|
| No database mutation happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminOrderReturnRefundPlan = (order, returnRequest) => {
  assertAdminOrderReturnCanBeRefunded(returnRequest);

  assertOrderPaymentAllowsReturnRefund(order);

  /*
    |--------------------------------------------------------------------------
    | Linked Order Relationship
    |--------------------------------------------------------------------------
    */

  const linkedOrderIsValid =
    String(returnRequest.order) === String(order._id) &&
    String(returnRequest.customer) === String(order.customer);

  if (!linkedOrderIsValid) {
    throw createAdminOrderReturnRefundStateInvalidError();
  }

  const items = buildTrustedAdminOrderReturnRefundItems(order, returnRequest);

  const refundedQuantity = items.reduce((total, item) => {
    return total + item.refundableQuantity;
  }, 0);

  const refundAmount = items.reduce((total, item) => {
    return total + item.lineRefundAmount;
  }, 0);

  if (refundedQuantity <= 0 || refundAmount <= 0) {
    throw createAdminOrderReturnNothingRefundableError();
  }

  const currency = order.totals?.currency;

  if (!currency) {
    throw createAdminOrderReturnRefundStateInvalidError();
  }

  return {
    orderId: order._id,

    orderNumber: order.orderNumber,

    returnRequestId: returnRequest._id,

    returnRequestNumber: returnRequest.returnRequestNumber,

    customerId: returnRequest.customer,

    currency,

    refundedQuantity,

    refundAmount,

    items,
  };
};

/*
|--------------------------------------------------------------------------
| Build Trusted Return Refund Items
|--------------------------------------------------------------------------
*/

const buildTrustedAdminOrderReturnRefundItems = (order, returnRequest) => {
  const trustedOrderItemMap = buildTrustedOrderItemMap(order.items);

  const refundItems = [];

  for (const returnItem of returnRequest.items) {
    const orderItemId = String(returnItem.orderItemId);

    const trustedOrderItem = trustedOrderItemMap.get(orderItemId);

    if (!trustedOrderItem) {
      throw createAdminOrderReturnRefundOrderItemInvalidError(
        returnItem.orderItemId,
      );
    }

    /*
      |--------------------------------------------------------------------------
      | Verify Trusted Snapshot Relationship
      |--------------------------------------------------------------------------
      */

    const snapshotMatches =
      String(trustedOrderItem.product) === String(returnItem.product) &&
      String(trustedOrderItem.variantId) === String(returnItem.variantId) &&
      trustedOrderItem.sku === returnItem.sku;

    if (!snapshotMatches) {
      throw createAdminOrderReturnRefundOrderItemInvalidError(
        returnItem.orderItemId,
      );
    }

    /*
      |--------------------------------------------------------------------------
      | Validate Completed Inspection
      |--------------------------------------------------------------------------
      */

    const { resellableQuantity, damagedQuantity, rejectedQuantity } =
      assertOrderReturnItemInspectionIsComplete(returnItem);

    /*
      |--------------------------------------------------------------------------
      | Refundable Quantity
      |--------------------------------------------------------------------------
      |
      | Accepted physical Return:
      |
      | resellable + damaged
      |
      | rejected units are excluded.
      |--------------------------------------------------------------------------
      */

    const refundableQuantity = resellableQuantity + damagedQuantity;

    /*
     * An individual line may have zero refundable quantity.
     */
    if (refundableQuantity === 0) {
      continue;
    }

    /*
      |--------------------------------------------------------------------------
      | Trusted Original Purchase Price
      |--------------------------------------------------------------------------
      */

    const unitRefundAmount = Number(trustedOrderItem.pricing?.unitFinalPrice);

    if (!Number.isInteger(unitRefundAmount) || unitRefundAmount < 0) {
      throw createAdminOrderReturnRefundOrderItemInvalidError(
        returnItem.orderItemId,
      );
    }

    const lineRefundAmount = unitRefundAmount * refundableQuantity;

    refundItems.push({
      orderItemId: trustedOrderItem._id,

      productId: trustedOrderItem.product,

      variantId: trustedOrderItem.variantId,

      sku: trustedOrderItem.sku,

      returnedQuantity: Number(returnItem.quantity),

      refundableQuantity,

      rejectedQuantity,

      unitRefundAmount,

      lineRefundAmount,
    });
  }

  return refundItems;
};

/*
|--------------------------------------------------------------------------
| Build Admin Refunded Return Request State
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildAdminRefundedOrderReturnState = (
  returnRequest,
  refundPlan,
  { refundData, adminId, refundedAt = new Date() },
) => {
  assertAdminOrderReturnCanBeRefunded(returnRequest);

  const refundedState = {
    refund: {
      refundedQuantity: refundPlan.refundedQuantity,

      amount: refundPlan.refundAmount,

      currency: refundPlan.currency,

      referenceId: refundData.referenceId,

      note: refundData.note ?? null,

      refundedBy: adminId,

      refundedAt,
    },

    updatedBy: adminId,
  };

  if (refundData.adminNote !== undefined) {
    refundedState.adminNote = refundData.adminNote;
  }

  return refundedState;
};

/*
|--------------------------------------------------------------------------
| Build Order Payment State for Return Refund
|--------------------------------------------------------------------------
*/

const buildAdminOrderReturnRefundPaymentPlan = (
  order,
  { previousRefundAmount, currentRefundAmount, refundedAt },
) => {
  const orderGrandTotal = Number(order.totals?.grandTotal);

  if (!Number.isInteger(orderGrandTotal) || orderGrandTotal <= 0) {
    throw createAdminOrderReturnRefundOrderStateInvalidError(order._id);
  }

  const previousAmount = Number(previousRefundAmount);

  const currentAmount = Number(currentRefundAmount);

  if (
    !Number.isInteger(previousAmount) ||
    previousAmount < 0 ||
    !Number.isInteger(currentAmount) ||
    currentAmount <= 0
  ) {
    throw createAdminOrderReturnRefundOrderStateInvalidError(order._id);
  }

  const cumulativeRefundAmount = previousAmount + currentAmount;

  /*
    |--------------------------------------------------------------------------
    | Never Refund More Than the Order Total
    |--------------------------------------------------------------------------
    */

  if (cumulativeRefundAmount > orderGrandTotal) {
    throw createAdminOrderReturnRefundExceedsOrderTotalError({
      orderGrandTotal,

      previousRefundAmount: previousAmount,

      requestedRefundAmount: currentAmount,
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Determine Payment State
    |--------------------------------------------------------------------------
    */

  const targetPaymentStatus =
    cumulativeRefundAmount === orderGrandTotal
      ? ORDER_PAYMENT_STATUSES.REFUNDED
      : ORDER_PAYMENT_STATUSES.PARTIALLY_REFUNDED;

  const existingPayment = normalizeOrderSubdocument(order.payment);

  const payment = {
    ...existingPayment,

    status: targetPaymentStatus,

    /*
     * failedAt cannot remain set after successful refund processing.
     */
    failedAt: null,
  };

  /*
    |--------------------------------------------------------------------------
    | refundedAt Represents Full Payment Refund Completion
    |--------------------------------------------------------------------------
    |
    | A partial refund does not mean the entire payment has been refunded.
    |--------------------------------------------------------------------------
    */

  if (targetPaymentStatus === ORDER_PAYMENT_STATUSES.REFUNDED) {
    payment.refundedAt = refundedAt;
  }

  return {
    previousPaymentStatus: existingPayment.status,

    targetPaymentStatus,

    previousCumulativeRefundAmount: previousAmount,

    cumulativeRefundAmount,

    currentRefundAmount: currentAmount,

    orderGrandTotal,

    payment,
  };
};

/*
|--------------------------------------------------------------------------
| Build Return Refund Audit Data
|--------------------------------------------------------------------------
*/

const buildOrderReturnRefundAuditData = (
  order,
  returnRequest,
  refundPlan,
  paymentPlan,
  { refundData, adminId, refundedAt },
) => {
  return {
    order: order._id,

    orderNumber: order.orderNumber,

    returnRequest: returnRequest._id,

    returnRequestNumber: returnRequest.returnRequestNumber,

    customer: returnRequest.customer,

    items: refundPlan.items.map((item) => {
      return {
        orderItemId: item.orderItemId,

        product: item.productId,

        variantId: item.variantId,

        sku: item.sku,

        returnedQuantity: item.returnedQuantity,

        refundableQuantity: item.refundableQuantity,

        rejectedQuantity: item.rejectedQuantity,

        unitRefundAmount: item.unitRefundAmount,

        lineRefundAmount: item.lineRefundAmount,
      };
    }),

    refundedQuantity: refundPlan.refundedQuantity,

    amount: refundPlan.refundAmount,

    currency: refundPlan.currency,

    previousPaymentStatus: paymentPlan.previousPaymentStatus,

    paymentStatus: paymentPlan.targetPaymentStatus,

    previousCumulativeRefundAmount: paymentPlan.previousCumulativeRefundAmount,

    cumulativeRefundAmount: paymentPlan.cumulativeRefundAmount,

    orderGrandTotal: paymentPlan.orderGrandTotal,

    referenceId: refundData.referenceId,

    note: refundData.note ?? null,

    refundedBy: adminId,

    refundedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Apply Return Refund Payment State to Order
|--------------------------------------------------------------------------
*/

const applyAdminOrderReturnRefundPaymentState = (
  order,
  paymentPlan,
  adminId,
) => {
  order.set("payment", paymentPlan.payment);

  order.set("updatedBy", adminId);

  return order;
};

/*
|--------------------------------------------------------------------------
| Execute Atomic Admin Order Return Refund
|--------------------------------------------------------------------------
*/

const executeAtomicAdminOrderReturnRefund = async ({
  returnRequestId,
  adminId,
  refundData,
}) => {
  const session = await mongoose.startSession();

  let loadedReturnRequest = null;

  try {
    let refundedReturnRequest;

    await session.withTransaction(
      async () => {
        requireActiveOrderTransaction(session);

        /*
          |--------------------------------------------------------------------------
          | Load Completed Return Request
          |--------------------------------------------------------------------------
          */

        const returnRequest = await findAdminOrderReturnRequestForProcessing(
          returnRequestId,
          {
            session,
          },
        );

        if (!returnRequest) {
          throw createAdminOrderReturnRequestNotFoundError();
        }

        loadedReturnRequest = returnRequest;

        /*
          |--------------------------------------------------------------------------
          | Load Linked Order
          |--------------------------------------------------------------------------
          */

        const order = await findAdminOrderForStatusUpdate(returnRequest.order, {
          session,
        });

        if (!order) {
          throw createAdminOrderReturnRefundOrderStateInvalidError(
            returnRequest.order,
          );
        }

        /*
          |--------------------------------------------------------------------------
          | Shared Financial Timestamp
          |--------------------------------------------------------------------------
          */

        const refundedAt = new Date();

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Current Refund Plan
          |--------------------------------------------------------------------------
          */

        const refundPlan = buildAdminOrderReturnRefundPlan(
          order,
          returnRequest,
        );

        /*
          |--------------------------------------------------------------------------
          | Read Previous Return Refunds for this Order
          |--------------------------------------------------------------------------
          */

        const previousRefundTotals = await getOrderReturnRefundTotals(
          order._id,
          {
            session,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Calculate Target Payment State
          |--------------------------------------------------------------------------
          */

        const paymentPlan = buildAdminOrderReturnRefundPaymentPlan(order, {
          previousRefundAmount: previousRefundTotals.totalRefundAmount,

          currentRefundAmount: refundPlan.refundAmount,

          refundedAt,
        });

        /*
          |--------------------------------------------------------------------------
          | Build Trusted Return Refund State
          |--------------------------------------------------------------------------
          */

        const refundedReturnState = buildAdminRefundedOrderReturnState(
          returnRequest,
          refundPlan,
          {
            refundData,
            adminId,
            refundedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Build Immutable Refund Audit
          |--------------------------------------------------------------------------
          */

        const refundAuditData = buildOrderReturnRefundAuditData(
          order,
          returnRequest,
          refundPlan,
          paymentPlan,
          {
            refundData,
            adminId,
            refundedAt,
          },
        );

        /*
          |--------------------------------------------------------------------------
          | Create Immutable Financial Audit
          |--------------------------------------------------------------------------
          |
          | Unique Return Request + reference indexes provide additional
          | idempotency protection.
          |--------------------------------------------------------------------------
          */

        await createOrderReturnRefundAuditEntry(refundAuditData, {
          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Update Order Payment
          |--------------------------------------------------------------------------
          */

        applyAdminOrderReturnRefundPaymentState(order, paymentPlan, adminId);

        await saveOrderDocument(order, {
          session,
        });

        /*
          |--------------------------------------------------------------------------
          | Update Return Request Refund State
          |--------------------------------------------------------------------------
          */

        returnRequest.set(refundedReturnState);

        refundedReturnRequest = await saveOrderReturnRequestDocument(
          returnRequest,
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

    return refundedReturnRequest;
  } catch (error) {
    /*
      |--------------------------------------------------------------------------
      | Duplicate Financial Audit
      |--------------------------------------------------------------------------
      */

    if (isMongoDuplicateKeyError(error)) {
      throw translateAdminOrderReturnRefundDuplicateError(error, {
        returnRequest: loadedReturnRequest ?? {
          status: ORDER_RETURN_STATUSES.COMPLETED,

          refund: {},
        },

        referenceId: refundData.referenceId,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Concurrent Financial Mutation
      |--------------------------------------------------------------------------
      */

    if (isOrderReturnTransactionConflict(error)) {
      throw createAdminOrderReturnRefundConflictError();
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Refund Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const refundAdminOrderReturnRequest = async (
  returnRequestId,
  adminId,
  refundData,
) => {
  if (!adminId) {
    throw new Error("Admin ID is required to refund a Return Request");
  }

  if (!refundData) {
    throw new Error("Return refund data is required");
  }

  if (!refundData.referenceId) {
    throw new Error("Return refund reference ID is required");
  }

  return executeAtomicAdminOrderReturnRefund({
    returnRequestId,
    adminId,
    refundData,
  });
};
