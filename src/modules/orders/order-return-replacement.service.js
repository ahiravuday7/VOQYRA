import {
  ORDER_RETURN_ITEM_INSPECTION_STATUSES,
  ORDER_RETURN_STATUSES,
} from "../../shared/constants/order.constants.js";

import AppError from "../../shared/errors/app-error.js";

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
