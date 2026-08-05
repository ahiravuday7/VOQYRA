import mongoose from "mongoose";

import { ORDER_RETURN_QUANTITY_CONSUMING_STATUS_VALUES } from "../../shared/constants/order.constants.js";

import OrderReturnRequest from "./order-return.model.js";

/*
|--------------------------------------------------------------------------
| Normalize Return Repository Object ID
|--------------------------------------------------------------------------
*/

const normalizeReturnObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
};

/*
|--------------------------------------------------------------------------
| Customer Return Projection
|--------------------------------------------------------------------------
|
| Internal admin and warehouse actor fields are intentionally excluded.
|--------------------------------------------------------------------------
*/

const CUSTOMER_ORDER_RETURN_PROJECTION = Object.freeze({
  _id: 1,

  returnRequestNumber: 1,

  order: 1,

  orderNumber: 1,

  items: 1,

  requestedResolution: 1,

  status: 1,

  customerNote: 1,

  "approval.approvedAt": 1,

  "rejection.reason": 1,

  "rejection.rejectedAt": 1,

  "receipt.receivedAt": 1,

  "completion.completedAt": 1,

  "cancellation.reason": 1,

  "cancellation.cancelledAt": 1,

  createdAt: 1,

  updatedAt: 1,
});
/*
|--------------------------------------------------------------------------
| Find Consumed Return Quantities
|--------------------------------------------------------------------------
|
| Returns the quantity already used by active or completed return requests
| for each requested Order item.
|--------------------------------------------------------------------------
*/

export const findConsumedOrderReturnQuantities = async ({
  orderId,
  orderItemIds,
  session = null,
}) => {
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    return [];
  }

  const normalizedOrderId = normalizeReturnObjectId(orderId);

  const normalizedOrderItemIds = orderItemIds.map(normalizeReturnObjectId);

  const aggregation = OrderReturnRequest.aggregate([
    {
      $match: {
        order: normalizedOrderId,

        status: {
          $in: ORDER_RETURN_QUANTITY_CONSUMING_STATUS_VALUES,
        },
      },
    },

    {
      $unwind: "$items",
    },

    {
      $match: {
        "items.orderItemId": {
          $in: normalizedOrderItemIds,
        },
      },
    },

    {
      $group: {
        _id: "$items.orderItemId",

        consumedQuantity: {
          $sum: "$items.quantity",
        },
      },
    },

    {
      $project: {
        _id: 0,

        orderItemId: "$_id",

        consumedQuantity: 1,
      },
    },
  ]);

  if (session) {
    aggregation.session(session);
  }

  return aggregation;
};

/*
|--------------------------------------------------------------------------
| Find Existing Return Request Number
|--------------------------------------------------------------------------
*/

export const findExistingReturnRequestNumber = (
  returnRequestNumber,
  { session = null } = {},
) => {
  const query = OrderReturnRequest.exists({
    returnRequestNumber,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Create Order Return Request Document
|--------------------------------------------------------------------------
|
| Array-based Model.create() ensures the transaction session is applied.
|--------------------------------------------------------------------------
*/

export const createOrderReturnRequestDocument = async (
  returnRequestData,
  { session } = {},
) => {
  const options = {};

  if (session) {
    options.session = session;
  }

  const [returnRequest] = await OrderReturnRequest.create(
    [returnRequestData],
    options,
  );

  return returnRequest;
};

/*
|--------------------------------------------------------------------------
| List Customer Order Return Requests
|--------------------------------------------------------------------------
*/

export const listCustomerOrderReturnRequests = async (
  customerId,
  {
    page = 1,

    limit = 20,

    status,

    requestedResolution,

    sortDirection = "desc",
  } = {},
) => {
  const filter = {
    customer: customerId,
  };

  if (status) {
    filter.status = status;
  }

  if (requestedResolution) {
    filter.requestedResolution = requestedResolution;
  }

  const skip = (page - 1) * limit;

  const sortValue = sortDirection === "asc" ? 1 : -1;

  const [returnRequests, total] = await Promise.all([
    OrderReturnRequest.find(filter)
      .select(CUSTOMER_ORDER_RETURN_PROJECTION)
      .sort({
        createdAt: sortValue,

        _id: sortValue,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    OrderReturnRequest.countDocuments(filter),
  ]);

  return {
    returnRequests,
    total,
  };
};

/*
|--------------------------------------------------------------------------
| Find Customer Order Return Request by ID
|--------------------------------------------------------------------------
|
| Ownership is part of the database query.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderReturnRequestById = (
  returnRequestId,
  customerId,
) => {
  return OrderReturnRequest.findOne({
    _id: returnRequestId,

    customer: customerId,
  })
    .select(CUSTOMER_ORDER_RETURN_PROJECTION)
    .lean();
};

/*
|--------------------------------------------------------------------------
| Find Customer Return Request for Cancellation
|--------------------------------------------------------------------------
|
| Returns a Mongoose document because the cancellation workflow must
| update and save it.
|
| Ownership is included directly in the database query.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderReturnRequestForCancellation = (
  returnRequestId,
  customerId,
  { session = null } = {},
) => {
  const query = OrderReturnRequest.findOne({
    _id: returnRequestId,

    customer: customerId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Save Order Return Request Document
|--------------------------------------------------------------------------
*/

export const saveOrderReturnRequestDocument = (
  returnRequest,
  { session = null } = {},
) => {
  const options = {
    validateBeforeSave: true,
  };

  if (session) {
    options.session = session;
  }

  return returnRequest.save(options);
};
