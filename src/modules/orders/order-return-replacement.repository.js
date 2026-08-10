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
