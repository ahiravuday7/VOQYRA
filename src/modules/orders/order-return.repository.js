import mongoose from "mongoose";

import { ORDER_RETURN_QUANTITY_CONSUMING_STATUS_VALUES } from "../../shared/constants/order.constants.js";

import OrderReturnRequest from "./order-return.model.js";

import OrderReturnReplacement from "./order-return-replacement.model.js";

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

  "shipment.carrier": 1,

  "shipment.trackingNumber": 1,

  "shipment.trackingUrl": 1,

  "shipment.markedInTransitAt": 1,

  "receipt.receivedAt": 1,

  "completion.completedAt": 1,

  "cancellation.reason": 1,

  "cancellation.cancelledAt": 1,

  createdAt: 1,

  updatedAt: 1,
});

/*
|--------------------------------------------------------------------------
| Escape Regular Expression Search
|--------------------------------------------------------------------------
*/

const escapeOrderReturnSearchPattern = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| Admin Order Return List Projection
|--------------------------------------------------------------------------
*/

const ADMIN_ORDER_RETURN_LIST_PROJECTION = Object.freeze({
  _id: 1,

  returnRequestNumber: 1,

  order: 1,

  orderNumber: 1,

  customer: 1,

  items: 1,

  requestedResolution: 1,

  status: 1,

  customerNote: 1,

  adminNote: 1,

  approval: 1,

  rejection: 1,

  shipment: 1,

  receipt: 1,

  completion: 1,

  cancellation: 1,

  createdBy: 1,

  updatedBy: 1,

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

/*
|--------------------------------------------------------------------------
| List Admin Order Return Requests
|--------------------------------------------------------------------------
*/

export const listAdminOrderReturnRequests = async ({
  page = 1,

  limit = 20,

  search,

  status,

  requestedResolution,

  customerId,

  orderId,

  sortBy = "createdAt",

  sortDirection = "desc",
} = {}) => {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (requestedResolution) {
    filter.requestedResolution = requestedResolution;
  }

  if (customerId) {
    filter.customer = customerId;
  }

  if (orderId) {
    filter.order = orderId;
  }

  if (search) {
    const escapedSearch = escapeOrderReturnSearchPattern(search);

    const searchExpression = new RegExp(escapedSearch, "i");

    filter.$or = [
      {
        returnRequestNumber: searchExpression,
      },

      {
        orderNumber: searchExpression,
      },

      {
        "items.sku": searchExpression,
      },

      {
        "items.productName": searchExpression,
      },
    ];
  }

  const skip = (page - 1) * limit;

  const sortValue = sortDirection === "asc" ? 1 : -1;

  const sort = {
    [sortBy]: sortValue,

    _id: sortValue,
  };

  const [returnRequests, total] = await Promise.all([
    OrderReturnRequest.find(filter)
      .select(ADMIN_ORDER_RETURN_LIST_PROJECTION)
      .sort(sort)
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
| Find Admin Order Return Request by ID
|--------------------------------------------------------------------------
*/

export const findAdminOrderReturnRequestById = (returnRequestId) => {
  return OrderReturnRequest.findById(returnRequestId).lean();
};

/*
|--------------------------------------------------------------------------
| Find Admin Return Request for Decision
|--------------------------------------------------------------------------
|
| Returns a Mongoose document because approval and rejection update it.
|--------------------------------------------------------------------------
*/

export const findAdminOrderReturnRequestForDecision = (
  returnRequestId,
  { session = null } = {},
) => {
  const query = OrderReturnRequest.findById(returnRequestId);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Admin Return Request for Processing
|--------------------------------------------------------------------------
|
| Used by shipment, receipt, inspection and completion workflows.
|--------------------------------------------------------------------------
*/

export const findAdminOrderReturnRequestForProcessing = (
  returnRequestId,
  { session = null } = {},
) => {
  const query = OrderReturnRequest.findById(returnRequestId);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Aggregate Admin Order Return Metrics
|--------------------------------------------------------------------------
|
| MongoDB performs the counting.
|
| We deliberately do not load Return documents into Node.js merely to
| calculate dashboard totals.
|--------------------------------------------------------------------------
*/

export const aggregateAdminOrderReturnMetrics = async ({
  createdAtRange = null,
} = {}) => {
  const pipeline = [];

  /*
    |--------------------------------------------------------------------------
    | Optional Date Cohort
    |--------------------------------------------------------------------------
    */

  if (createdAtRange) {
    pipeline.push({
      $match: {
        createdAt: createdAtRange,
      },
    });
  }

  pipeline.push({
    $facet: {
      /*
        |--------------------------------------------------------------------------
        | Total
        |--------------------------------------------------------------------------
        */

      total: [
        {
          $count: "count",
        },
      ],

      /*
        |--------------------------------------------------------------------------
        | Status Counts
        |--------------------------------------------------------------------------
        */

      byStatus: [
        {
          $group: {
            _id: "$status",

            count: {
              $sum: 1,
            },
          },
        },
      ],

      /*
        |--------------------------------------------------------------------------
        | Resolution Counts
        |--------------------------------------------------------------------------
        */

      byResolution: [
        {
          $group: {
            _id: "$requestedResolution",

            count: {
              $sum: 1,
            },
          },
        },
      ],

      /*
        |--------------------------------------------------------------------------
        | Processed Refunds
        |--------------------------------------------------------------------------
        */

      refunds: [
        {
          $match: {
            "refund.refundedAt": {
              $ne: null,
            },
          },
        },

        {
          $group: {
            _id: null,

            count: {
              $sum: 1,
            },

            refundedQuantity: {
              $sum: "$refund.refundedQuantity",
            },

            amount: {
              $sum: "$refund.amount",
            },
          },
        },
      ],

      /*
        |--------------------------------------------------------------------------
        | Returns Awaiting Refund
        |--------------------------------------------------------------------------
        |
        | Directly count:
        |
        | completed
        | + refund resolution
        | + refund not processed
        |--------------------------------------------------------------------------
        */

      awaitingRefund: [
        {
          $match: {
            status: "completed",

            requestedResolution: "refund",

            "refund.refundedAt": null,
          },
        },

        {
          $count: "count",
        },
      ],

      /*
        |--------------------------------------------------------------------------
        | Returns Awaiting Replacement Creation
        |--------------------------------------------------------------------------
        |
        | This is deliberately NOT calculated as:
        |
        | completed replacement Returns - replacements created in date range
        |
        | because the Return and Replacement can be created on different days.
        |--------------------------------------------------------------------------
        */

      awaitingReplacementCreation: [
        {
          $match: {
            status: "completed",

            requestedResolution: "replacement",
          },
        },

        {
          $lookup: {
            from: OrderReturnReplacement.collection.name,

            localField: "_id",

            foreignField: "returnRequest",

            as: "replacementLinks",
          },
        },

        {
          $match: {
            "replacementLinks.0": {
              $exists: false,
            },
          },
        },

        {
          $count: "count",
        },
      ],
    },
  });

  const [metrics] = await OrderReturnRequest.aggregate(pipeline);

  return (
    metrics ?? {
      total: [],

      byStatus: [],

      byResolution: [],

      refunds: [],

      awaitingRefund: [],

      awaitingReplacementCreation: [],
    }
  );
};

/*
|--------------------------------------------------------------------------
| Aggregate Admin Order Return Daily Trend
|--------------------------------------------------------------------------
|
| Example output:
|
| [
|   {
|     date: "2026-08-01",
|     count: 4
|   }
| ]
|--------------------------------------------------------------------------
*/

export const aggregateAdminOrderReturnDailyTrend = async ({
  createdAtRange,
}) => {
  return OrderReturnRequest.aggregate([
    /*
      |--------------------------------------------------------------------------
      | Date Cohort
      |--------------------------------------------------------------------------
      */

    {
      $match: {
        createdAt: createdAtRange,
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Group By UTC Calendar Day
      |--------------------------------------------------------------------------
      */

    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",

            date: "$createdAt",

            timezone: "UTC",
          },
        },

        count: {
          $sum: 1,
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Chronological Order
      |--------------------------------------------------------------------------
      */

    {
      $sort: {
        _id: 1,
      },
    },

    /*
      |--------------------------------------------------------------------------
      | API-Friendly Shape
      |--------------------------------------------------------------------------
      */

    {
      $project: {
        _id: 0,

        date: "$_id",

        count: 1,
      },
    },
  ]);
};
