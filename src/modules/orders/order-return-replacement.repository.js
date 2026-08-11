import OrderReturnReplacement, {
  ORDER_RETURN_REPLACEMENT_STATUS,
} from "./order-return-replacement.model.js";

/*
|--------------------------------------------------------------------------
| Escape Replacement Search
|--------------------------------------------------------------------------
*/

const escapeReplacementSearchExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| Customer Replacement List Projection
|--------------------------------------------------------------------------
|
| Never expose warehouse/admin actor IDs or internal notes.
|--------------------------------------------------------------------------
*/

const CUSTOMER_ORDER_RETURN_REPLACEMENT_LIST_PROJECTION = Object.freeze({
  _id: 1,

  replacementNumber: 1,

  returnRequest: 1,

  returnRequestNumber: 1,

  order: 1,

  orderNumber: 1,

  status: 1,

  "items.replacementQuantity": 1,

  "reservation.reservedAt": 1,

  "processing.processedAt": 1,

  "shipment.shippedAt": 1,

  "shipment.deliveredAt": 1,

  "cancellation.cancelledAt": 1,

  "failure.failedAt": 1,

  createdAt: 1,

  updatedAt: 1,
});

/*
|--------------------------------------------------------------------------
| Customer Replacement Details Projection
|--------------------------------------------------------------------------
*/

const CUSTOMER_ORDER_RETURN_REPLACEMENT_DETAILS_PROJECTION = Object.freeze({
  _id: 1,

  replacementNumber: 1,

  returnRequest: 1,

  returnRequestNumber: 1,

  order: 1,

  orderNumber: 1,

  status: 1,

  /*
    |--------------------------------------------------------------------------
    | Customer-Safe Item Snapshots
    |--------------------------------------------------------------------------
    */

  "items._id": 1,

  "items.orderItemId": 1,

  "items.product": 1,

  "items.variantId": 1,

  "items.productName": 1,

  "items.sku": 1,

  "items.size": 1,

  "items.color": 1,

  "items.returnedQuantity": 1,

  "items.replacementQuantity": 1,

  /*
    |--------------------------------------------------------------------------
    | Customer-Safe Lifecycle Information
    |--------------------------------------------------------------------------
    */

  "reservation.reservedAt": 1,

  "processing.processedAt": 1,

  "shipment.carrier": 1,

  "shipment.trackingNumber": 1,

  "shipment.trackingUrl": 1,

  "shipment.shippedAt": 1,

  "shipment.deliveredAt": 1,

  "cancellation.reason": 1,

  "cancellation.cancelledAt": 1,

  "failure.reason": 1,

  "failure.failedAt": 1,

  createdAt: 1,

  updatedAt: 1,
});

/*
|--------------------------------------------------------------------------
| Create Order Return Replacement
|--------------------------------------------------------------------------
*/

export const createOrderReturnReplacementDocument = async (
  replacementData,
  { session = null } = {},
) => {
  const replacement = new OrderReturnReplacement(replacementData);

  return replacement.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Replacement by Return Request
|--------------------------------------------------------------------------
*/

export const findOrderReturnReplacementByReturnRequest = (
  returnRequestId,
  { session = null } = {},
) => {
  const query = OrderReturnReplacement.findOne({
    returnRequest: returnRequestId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Customer Replacement by Return Request
|--------------------------------------------------------------------------
|
| Ownership is enforced inside MongoDB.
|
| Only customer-safe summary fields are selected.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderReturnReplacementByReturnRequest = (
  returnRequestId,
  customerId,
) => {
  return OrderReturnReplacement.findOne({
    returnRequest: returnRequestId,

    customer: customerId,
  })
    .select(CUSTOMER_ORDER_RETURN_REPLACEMENT_LIST_PROJECTION)
    .lean();
};

/*
|--------------------------------------------------------------------------
| Save Replacement
|--------------------------------------------------------------------------
*/

export const saveOrderReturnReplacementDocument = (
  replacement,
  { session = null } = {},
) => {
  return replacement.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Replacement by ID
|--------------------------------------------------------------------------
*/

export const findOrderReturnReplacementById = (
  replacementId,
  { session = null } = {},
) => {
  const query = OrderReturnReplacement.findById(replacementId);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Transition Replacement To Shipped Atomically
|--------------------------------------------------------------------------
|
| processing -> shipped
|
| This transition happens inside the shipment transaction BEFORE Product
| inventory is committed.
|--------------------------------------------------------------------------
*/

export const transitionOrderReturnReplacementToShippedAtomically = ({
  replacementId,
  adminId,
  shipmentData,
  shippedAt,
  session,
}) => {
  return OrderReturnReplacement.findOneAndUpdate(
    {
      _id: replacementId,

      status: ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING,

      "reservation.reservedBy": {
        $ne: null,
      },

      "reservation.reservedAt": {
        $ne: null,
      },

      "processing.processedBy": {
        $ne: null,
      },

      "processing.processedAt": {
        $ne: null,
      },

      /*
      |--------------------------------------------------------------------------
      | Shipment Must Not Already Exist
      |--------------------------------------------------------------------------
      */

      "shipment.carrier": null,

      "shipment.trackingNumber": null,

      "shipment.shippedBy": null,

      "shipment.shippedAt": null,

      "shipment.deliveredAt": null,

      /*
      |--------------------------------------------------------------------------
      | No Competing Terminal State
      |--------------------------------------------------------------------------
      */

      "cancellation.cancelledAt": null,

      "failure.failedAt": null,
    },

    {
      $set: {
        status: ORDER_RETURN_REPLACEMENT_STATUS.SHIPPED,

        shipment: {
          carrier: shipmentData.carrier,

          trackingNumber: shipmentData.trackingNumber,

          trackingUrl: shipmentData.trackingUrl ?? null,

          note: shipmentData.note ?? null,

          shippedBy: adminId,

          shippedAt,

          deliveredBy: null,

          deliveredAt: null,
        },
      },
    },

    {
      new: true,

      runValidators: true,

      session,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Transition Replacement To Cancelled Atomically
|--------------------------------------------------------------------------
|
| reserved / processing -> cancelled
|--------------------------------------------------------------------------
*/

export const transitionOrderReturnReplacementToCancelledAtomically = ({
  replacementId,
  adminId,
  cancellationData,
  cancelledAt,
  session,
}) => {
  return OrderReturnReplacement.findOneAndUpdate(
    {
      _id: replacementId,

      status: {
        $in: [
          ORDER_RETURN_REPLACEMENT_STATUS.RESERVED,

          ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING,
        ],
      },

      "reservation.reservedBy": {
        $ne: null,
      },

      "reservation.reservedAt": {
        $ne: null,
      },

      /*
      |--------------------------------------------------------------------------
      | Shipment Must Never Have Started
      |--------------------------------------------------------------------------
      */

      "shipment.carrier": null,

      "shipment.trackingNumber": null,

      "shipment.shippedBy": null,

      "shipment.shippedAt": null,

      "shipment.deliveredAt": null,

      /*
      |--------------------------------------------------------------------------
      | No Existing Terminal State
      |--------------------------------------------------------------------------
      */

      "cancellation.cancelledAt": null,

      "failure.failedAt": null,
    },

    {
      $set: {
        status: ORDER_RETURN_REPLACEMENT_STATUS.CANCELLED,

        cancellation: {
          reason: cancellationData.reason,

          note: cancellationData.note ?? null,

          cancelledBy: adminId,

          cancelledAt,
        },
      },
    },

    {
      new: true,

      runValidators: true,

      session,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Transition Replacement To Failed Atomically
|--------------------------------------------------------------------------
|
| reserved / processing -> failed
|--------------------------------------------------------------------------
*/

export const transitionOrderReturnReplacementToFailedAtomically = ({
  replacementId,
  adminId,
  failureData,
  failedAt,
  session,
}) => {
  return OrderReturnReplacement.findOneAndUpdate(
    {
      _id: replacementId,

      status: {
        $in: [
          ORDER_RETURN_REPLACEMENT_STATUS.RESERVED,

          ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING,
        ],
      },

      "reservation.reservedBy": {
        $ne: null,
      },

      "reservation.reservedAt": {
        $ne: null,
      },

      /*
      |--------------------------------------------------------------------------
      | Shipment Must Never Have Started
      |--------------------------------------------------------------------------
      */

      "shipment.carrier": null,

      "shipment.trackingNumber": null,

      "shipment.shippedBy": null,

      "shipment.shippedAt": null,

      "shipment.deliveredAt": null,

      /*
      |--------------------------------------------------------------------------
      | No Existing Terminal State
      |--------------------------------------------------------------------------
      */

      "cancellation.cancelledAt": null,

      "failure.failedAt": null,
    },

    {
      $set: {
        status: ORDER_RETURN_REPLACEMENT_STATUS.FAILED,

        failure: {
          reason: failureData.reason,

          note: failureData.note ?? null,

          failedBy: adminId,

          failedAt,
        },
      },
    },

    {
      new: true,

      runValidators: true,

      session,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Mark Replacement Processing Atomically
|--------------------------------------------------------------------------
|
| Only:
|
| reserved -> processing
|
| This atomic filter also protects against two admins processing the same
| replacement concurrently.
|--------------------------------------------------------------------------
*/

export const markOrderReturnReplacementProcessingAtomically = ({
  replacementId,
  adminId,
  note = null,
  processedAt,
}) => {
  return OrderReturnReplacement.findOneAndUpdate(
    {
      _id: replacementId,

      status: ORDER_RETURN_REPLACEMENT_STATUS.RESERVED,

      /*
       * Reservation evidence must exist.
       */
      "reservation.reservedBy": {
        $ne: null,
      },

      "reservation.reservedAt": {
        $ne: null,
      },

      /*
       * No later fulfillment evidence may exist.
       */
      "processing.processedAt": null,

      "shipment.shippedAt": null,

      "cancellation.cancelledAt": null,

      "failure.failedAt": null,
    },

    {
      $set: {
        status: ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING,

        processing: {
          note,

          processedBy: adminId,

          processedAt,
        },
      },
    },

    {
      new: true,

      runValidators: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Mark Replacement Delivered Atomically
|--------------------------------------------------------------------------
|
| Only:
|
| shipped -> delivered
|
| No Product inventory operation happens here.
|--------------------------------------------------------------------------
*/

export const markOrderReturnReplacementDeliveredAtomically = ({
  replacementId,
  adminId,
  deliveredAt,
}) => {
  return OrderReturnReplacement.findOneAndUpdate(
    {
      _id: replacementId,

      status: ORDER_RETURN_REPLACEMENT_STATUS.SHIPPED,

      /*
        |--------------------------------------------------------------------------
        | Valid Reservation / Processing History
        |--------------------------------------------------------------------------
        */

      "reservation.reservedAt": {
        $ne: null,
      },

      "processing.processedAt": {
        $ne: null,
      },

      /*
        |--------------------------------------------------------------------------
        | Shipment Must Be Complete
        |--------------------------------------------------------------------------
        */

      "shipment.carrier": {
        $ne: null,
      },

      "shipment.trackingNumber": {
        $ne: null,
      },

      "shipment.shippedBy": {
        $ne: null,
      },

      "shipment.shippedAt": {
        $ne: null,
      },

      /*
        |--------------------------------------------------------------------------
        | Delivery Must Not Already Exist
        |--------------------------------------------------------------------------
        */

      "shipment.deliveredAt": null,

      /*
        |--------------------------------------------------------------------------
        | Terminal Conflict Protection
        |--------------------------------------------------------------------------
        */

      "cancellation.cancelledAt": null,

      "failure.failedAt": null,
    },

    {
      $set: {
        status: ORDER_RETURN_REPLACEMENT_STATUS.DELIVERED,

        "shipment.deliveredBy": adminId,

        "shipment.deliveredAt": deliveredAt,
      },
    },

    {
      new: true,

      runValidators: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Build Admin Replacement List Filter
|--------------------------------------------------------------------------
*/

const buildAdminOrderReturnReplacementListFilter = ({
  search,
  status,
  orderId,
  customerId,
} = {}) => {
  const filter = {};

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

  if (search) {
    const safeSearch = escapeReplacementSearchExpression(search);

    const searchExpression = new RegExp(safeSearch, "i");

    filter.$or = [
      {
        replacementNumber: searchExpression,
      },

      {
        returnRequestNumber: searchExpression,
      },

      {
        orderNumber: searchExpression,
      },
    ];
  }

  /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

  if (status) {
    filter.status = status;
  }

  /*
    |--------------------------------------------------------------------------
    | Order
    |--------------------------------------------------------------------------
    */

  if (orderId) {
    filter.order = orderId;
  }

  /*
    |--------------------------------------------------------------------------
    | Customer
    |--------------------------------------------------------------------------
    */

  if (customerId) {
    filter.customer = customerId;
  }

  return filter;
};

/*
|--------------------------------------------------------------------------
| List Admin Return Replacements
|--------------------------------------------------------------------------
*/

export const listAdminOrderReturnReplacements = async ({
  page = 1,
  limit = 20,

  search,
  status,
  orderId,
  customerId,

  sortBy = "createdAt",
  sortDirection = "desc",
} = {}) => {
  const filter = buildAdminOrderReturnReplacementListFilter({
    search,
    status,
    orderId,
    customerId,
  });

  const skip = (page - 1) * limit;

  const sortValue = sortDirection === "asc" ? 1 : -1;

  /*
    |--------------------------------------------------------------------------
    | Records + Count
    |--------------------------------------------------------------------------
    |
    | These are independent read operations.
    |--------------------------------------------------------------------------
    */

  const [replacements, total] = await Promise.all([
    OrderReturnReplacement.find(filter)
      .sort({
        [sortBy]: sortValue,

        _id: sortValue,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    OrderReturnReplacement.countDocuments(filter),
  ]);

  return {
    replacements,
    total,
  };
};

/*
|--------------------------------------------------------------------------
| Find Admin Return Replacement by ID
|--------------------------------------------------------------------------
*/

export const findAdminOrderReturnReplacementById = (replacementId) => {
  return OrderReturnReplacement.findById(replacementId).lean();
};

/*
|--------------------------------------------------------------------------
| List Customer Return Replacements
|--------------------------------------------------------------------------
*/

export const listCustomerOrderReturnReplacements = async (
  customerId,
  {
    page = 1,
    limit = 20,

    search,
    status,
    orderId,

    sortBy = "createdAt",
    sortDirection = "desc",
  } = {},
) => {
  /*
    |--------------------------------------------------------------------------
    | Ownership Boundary
    |--------------------------------------------------------------------------
    */

  const filter = {
    customer: customerId,
  };

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

  if (search) {
    const safeSearch = escapeReplacementSearchExpression(search);

    const searchExpression = new RegExp(safeSearch, "i");

    filter.$or = [
      {
        replacementNumber: searchExpression,
      },

      {
        returnRequestNumber: searchExpression,
      },

      {
        orderNumber: searchExpression,
      },
    ];
  }

  /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

  if (status) {
    filter.status = status;
  }

  /*
    |--------------------------------------------------------------------------
    | Order
    |--------------------------------------------------------------------------
    */

  if (orderId) {
    filter.order = orderId;
  }

  const skip = (page - 1) * limit;

  const sortValue = sortDirection === "asc" ? 1 : -1;

  const [replacements, total] = await Promise.all([
    OrderReturnReplacement.find(filter)
      .select(CUSTOMER_ORDER_RETURN_REPLACEMENT_LIST_PROJECTION)
      .sort({
        [sortBy]: sortValue,

        _id: sortValue,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    OrderReturnReplacement.countDocuments(filter),
  ]);

  return {
    replacements,
    total,
  };
};

/*
|--------------------------------------------------------------------------
| Find Customer Return Replacement by ID
|--------------------------------------------------------------------------
|
| Important:
|
| Ownership is checked in the MongoDB query itself.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderReturnReplacementById = (
  replacementId,
  customerId,
) => {
  return OrderReturnReplacement.findOne({
    _id: replacementId,

    customer: customerId,
  })
    .select(CUSTOMER_ORDER_RETURN_REPLACEMENT_DETAILS_PROJECTION)
    .lean();
};

/*
|--------------------------------------------------------------------------
| Aggregate Admin Return Replacement Metrics
|--------------------------------------------------------------------------
*/

export const aggregateAdminOrderReturnReplacementMetrics = async () => {
  const [metrics] = await OrderReturnReplacement.aggregate([
    {
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
      },
    },
  ]);

  return (
    metrics ?? {
      total: [],

      byStatus: [],
    }
  );
};
