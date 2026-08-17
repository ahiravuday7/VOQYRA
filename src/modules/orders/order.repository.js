import mongoose from "mongoose";
import Order from "./order.model.js";

import {
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

/*
|--------------------------------------------------------------------------
| Create Order Document
|--------------------------------------------------------------------------
*/

export const createOrderDocument = async (
  orderData,
  { session = null } = {},
) => {
  const order = new Order(orderData);

  return order.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Order by ID
|--------------------------------------------------------------------------
*/

export const findOrderById = (orderId, { session = null } = {}) => {
  const query = Order.findById(orderId);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Order by Number
|--------------------------------------------------------------------------
*/

export const findOrderByNumber = (orderNumber, { session = null } = {}) => {
  const query = Order.findOne({
    orderNumber,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Existing Order Number
|--------------------------------------------------------------------------
|
| Used when generating a unique customer-facing Order number.
|
| The database unique index remains the final protection
| against concurrent duplicate Order numbers.
|--------------------------------------------------------------------------
*/

export const findExistingOrderNumber = (
  orderNumber,
  { session = null } = {},
) => {
  const query = Order.findOne({
    orderNumber,
  })
    .select({
      _id: 1,
      orderNumber: 1,
    })
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Save Order Document
|--------------------------------------------------------------------------
*/

export const saveOrderDocument = async (order, { session = null } = {}) => {
  return order.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Customer Order Sort Fields
|--------------------------------------------------------------------------
*/

const CUSTOMER_ORDER_SORT_FIELDS = Object.freeze({
  createdAt: "createdAt",

  updatedAt: "updatedAt",

  orderNumber: "orderNumber",

  grandTotal: "totals.grandTotal",
});
/*
|--------------------------------------------------------------------------
| Admin Order Sort Fields
|--------------------------------------------------------------------------
*/

const ADMIN_ORDER_SORT_FIELDS = Object.freeze({
  createdAt: "createdAt",

  updatedAt: "updatedAt",

  orderNumber: "orderNumber",

  grandTotal: "totals.grandTotal",

  status: "status",

  paymentStatus: "payment.status",
});

/*
|--------------------------------------------------------------------------
| Escape Search Expression
|--------------------------------------------------------------------------
|
| Prevents search characters such as:
|
| .
| *
| +
| ?
| [
| ]
|
| from becoming regular-expression operators.
|--------------------------------------------------------------------------
*/

const escapeSearchExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| Build Admin Order Filter
|--------------------------------------------------------------------------
*/

const buildAdminOrderFilter = (filters) => {
  const filter = {};

  /*
    |--------------------------------------------------------------------------
    | Direct Status Filters
    |--------------------------------------------------------------------------
    */

  if (filters.status) {
    filter.status = filters.status;
  }

  if (filters.paymentStatus) {
    filter["payment.status"] = filters.paymentStatus;
  }

  if (filters.paymentMethod) {
    filter["payment.method"] = filters.paymentMethod;
  }

  if (filters.inventoryStatus) {
    filter.inventoryStatus = filters.inventoryStatus;
  }

  /*
    |--------------------------------------------------------------------------
    | Customer Filter
    |--------------------------------------------------------------------------
    */

  if (filters.customerId) {
    filter.customer = new mongoose.Types.ObjectId(filters.customerId);
  }

  /*
    |--------------------------------------------------------------------------
    | Creation Date Range
    |--------------------------------------------------------------------------
    */

  if (filters.dateFrom || filters.dateTo) {
    filter.createdAt = {};

    if (filters.dateFrom) {
      filter.createdAt.$gte = filters.dateFrom;
    }

    if (filters.dateTo) {
      filter.createdAt.$lte = filters.dateTo;
    }
  }

  /*
    |--------------------------------------------------------------------------
    | Grand Total Range
    |--------------------------------------------------------------------------
    */

  if (filters.minTotal !== undefined || filters.maxTotal !== undefined) {
    filter["totals.grandTotal"] = {};

    if (filters.minTotal !== undefined) {
      filter["totals.grandTotal"].$gte = filters.minTotal;
    }

    if (filters.maxTotal !== undefined) {
      filter["totals.grandTotal"].$lte = filters.maxTotal;
    }
  }

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    |
    | Searchable fields:
    |
    | - MongoDB Order ID
    | - Order number
    | - Shipping full name
    | - Shipping phone
    | - Shipping email
    | - Item SKU
    | - Product snapshot name
    |--------------------------------------------------------------------------
    */

  if (filters.search) {
    const normalizedSearch = filters.search.trim();

    const escapedSearch = escapeSearchExpression(normalizedSearch);

    const searchExpression = new RegExp(escapedSearch, "i");

    const searchConditions = [
      {
        orderNumber: searchExpression,
      },

      {
        "shippingAddress.fullName": searchExpression,
      },

      {
        "shippingAddress.phone": searchExpression,
      },

      {
        "shippingAddress.email": searchExpression,
      },

      {
        "items.sku": searchExpression,
      },

      {
        "items.productName": searchExpression,
      },
    ];

    /*
     * Also support searching with the MongoDB Order ID.
     */
    if (mongoose.isValidObjectId(normalizedSearch)) {
      searchConditions.push({
        _id: new mongoose.Types.ObjectId(normalizedSearch),
      });
    }

    filter.$or = searchConditions;
  }

  return filter;
};
/*
|--------------------------------------------------------------------------
| Build Customer Order Filter
|--------------------------------------------------------------------------
*/

const buildCustomerOrderFilter = (customerId, filters) => {
  const filter = {
    customer: customerId,
  };

  if (filters.status) {
    filter.status = filters.status;
  }

  if (filters.paymentStatus) {
    filter["payment.status"] = filters.paymentStatus;
  }

  if (filters.inventoryStatus) {
    filter.inventoryStatus = filters.inventoryStatus;
  }

  return filter;
};

/*
|--------------------------------------------------------------------------
| List Customer Orders
|--------------------------------------------------------------------------
*/

export const listCustomerOrders = async (customerId, filters) => {
  const {
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortDirection = "desc",
  } = filters;

  const skip = (page - 1) * limit;

  const normalizedSortField =
    CUSTOMER_ORDER_SORT_FIELDS[sortBy] ?? CUSTOMER_ORDER_SORT_FIELDS.createdAt;

  const normalizedSortDirection = sortDirection === "asc" ? 1 : -1;

  const filter = buildCustomerOrderFilter(customerId, filters);

  const [orders, totalItems] = await Promise.all([
    Order.find(filter)
      .select({
        orderNumber: 1,

        items: 1,

        totals: 1,

        payment: 1,

        shipment: 1,

        status: 1,

        inventoryStatus: 1,

        cancellation: 1,

        createdAt: 1,

        updatedAt: 1,
      })
      .sort({
        [normalizedSortField]: normalizedSortDirection,

        _id: normalizedSortDirection,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    Order.countDocuments(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    orders,

    pagination: {
      page,
      limit,
      totalItems,
      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Find Customer-Owned Order by ID
|--------------------------------------------------------------------------
|
| Ownership is included directly in the database query.
|
| Do not fetch only by Order ID and compare the customer later.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderById = (
  orderId,
  customerId,
  { session = null } = {},
) => {
  const query = Order.findOne({
    _id: orderId,

    customer: customerId,
  }).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Customer Order For Online Payment Finalization
|--------------------------------------------------------------------------
|
| Returns a Mongoose document because the Order will be modified and saved
| inside the same MongoDB transaction that commits reserved inventory.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderForOnlinePaymentFinalization = (
  orderId,

  customerId,

  { session = null } = {},
) => {
  const query = Order.findOne({
    _id: orderId,

    customer: customerId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Customer Order for Cancellation
|--------------------------------------------------------------------------
|
| Returns a Mongoose document because the Order will be updated
| and saved inside the same transaction.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderForCancellation = (
  orderId,
  customerId,
  { session = null } = {},
) => {
  const query = Order.findOne({
    _id: orderId,

    customer: customerId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| List Admin Orders
|--------------------------------------------------------------------------
*/

export const listAdminOrders = async (filters) => {
  const {
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortDirection = "desc",
  } = filters;

  const skip = (page - 1) * limit;

  const normalizedSortField =
    ADMIN_ORDER_SORT_FIELDS[sortBy] ?? ADMIN_ORDER_SORT_FIELDS.createdAt;

  const normalizedSortDirection = sortDirection === "asc" ? 1 : -1;

  const filter = buildAdminOrderFilter(filters);

  const [orders, totalItems] = await Promise.all([
    Order.find(filter)
      .select({
        orderNumber: 1,

        customer: 1,

        items: 1,

        shippingAddress: 1,

        totals: 1,

        payment: 1,

        shipment: 1,

        status: 1,

        inventoryStatus: 1,

        cancellation: 1,

        refund: 1,

        customerNote: 1,

        adminNote: 1,

        createdBy: 1,

        updatedBy: 1,

        createdAt: 1,

        updatedAt: 1,
      })
      .sort({
        [normalizedSortField]: normalizedSortDirection,

        _id: normalizedSortDirection,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    Order.countDocuments(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    orders,

    pagination: {
      page,
      limit,
      totalItems,
      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Find Admin Order by ID
|--------------------------------------------------------------------------
|
| Admin lookup does not apply customer ownership filtering.
|--------------------------------------------------------------------------
*/

export const findAdminOrderById = (orderId, { session = null } = {}) => {
  const query = Order.findById(orderId).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Admin Order for Status Update
|--------------------------------------------------------------------------
|
| Returns a Mongoose document because the Order will be modified and saved
| inside the same transaction.
|--------------------------------------------------------------------------
*/

export const findAdminOrderForStatusUpdate = (
  orderId,
  { session = null } = {},
) => {
  const query = Order.findById(orderId);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Customer Order for Return Request
|--------------------------------------------------------------------------
|
| Ownership is included in the database query.
|
| A customer must never be able to create a return request against
| another customer's Order.
|--------------------------------------------------------------------------
*/

export const findCustomerOrderForReturnRequest = (
  orderId,
  customerId,
  { session = null } = {},
) => {
  const query = Order.findOne({
    _id: orderId,

    customer: customerId,
  }).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Bump Order Return Request Version
|--------------------------------------------------------------------------
|
| Must be called inside the return-request transaction.
|
| This shared Order write protects against concurrent return requests
| exceeding the originally purchased quantity.
|--------------------------------------------------------------------------
*/

export const bumpOrderReturnRequestVersion = async (
  orderId,
  customerId,
  { session },
) => {
  const result = await Order.updateOne(
    {
      _id: orderId,

      customer: customerId,
    },

    {
      $inc: {
        returnRequestVersion: 1,
      },
    },

    {
      session,
    },
  );

  return result.matchedCount === 1;
};

/*
|--------------------------------------------------------------------------
| Find Expired Online Inventory Reservations
|--------------------------------------------------------------------------
|
| Part 200 only identifies candidates.
|
| It does NOT:
|
| - release inventory
| - cancel Order
| - update PaymentTransaction
|
| Part 201 will perform those mutations safely.
|--------------------------------------------------------------------------
*/

export const findExpiredOnlineOrderReservations = ({
  now = new Date(),

  limit = 50,
} = {}) => {
  /*
    |--------------------------------------------------------------------------
    | Bounded Query
    |--------------------------------------------------------------------------
    */

  const safeLimit = Math.min(
    Math.max(
      Number.isSafeInteger(limit) ? limit : 50,

      1,
    ),

    100,
  );

  return Order.find({
    status: ORDER_STATUSES.PENDING,

    "payment.method": ORDER_PAYMENT_METHODS.ONLINE,

    "payment.status": ORDER_PAYMENT_STATUSES.PENDING,

    inventoryStatus: ORDER_INVENTORY_STATUSES.RESERVED,

    inventoryReservationExpiresAt: {
      $ne: null,

      $lte: now,
    },
  })
    .sort({
      inventoryReservationExpiresAt: 1,

      _id: 1,
    })
    .limit(safeLimit)
    .select({
      _id: 1,

      orderNumber: 1,

      customer: 1,

      inventoryReservationExpiresAt: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| Find Exact Order For Reservation Expiry
|--------------------------------------------------------------------------
|
| Revalidation happens inside the MongoDB transaction.
|--------------------------------------------------------------------------
*/

export const findOrderForInventoryReservationExpiry = (
  orderId,

  {
    now = new Date(),

    session = null,
  } = {},
) => {
  const query = Order.findOne({
    _id: orderId,

    status: ORDER_STATUSES.PENDING,

    "payment.method": ORDER_PAYMENT_METHODS.ONLINE,

    "payment.status": ORDER_PAYMENT_STATUSES.PENDING,

    inventoryStatus: ORDER_INVENTORY_STATUSES.RESERVED,

    inventoryReservationExpiresAt: {
      $ne: null,

      $lte: now,
    },
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Claim Reservation For Successful Payment
|--------------------------------------------------------------------------
|
| Compare-and-swap:
|
| Only succeeds when the Order still has the exact reservation version
| the Payment transaction originally read.
|--------------------------------------------------------------------------
*/

export const claimOrderReservationForPaymentFinalization = ({
  orderId,

  expectedVersion,

  session,
}) => {
  return Order.findOneAndUpdate(
    {
      _id: orderId,

      status: ORDER_STATUSES.PENDING,

      "payment.status": ORDER_PAYMENT_STATUSES.PENDING,

      inventoryStatus: ORDER_INVENTORY_STATUSES.RESERVED,

      inventoryReservationVersion: expectedVersion,
    },

    {
      $inc: {
        inventoryReservationVersion: 1,
      },
    },

    {
      returnDocument: "after",

      session,

      runValidators: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Claim Reservation For Automatic Expiry
|--------------------------------------------------------------------------
*/

export const claimOrderReservationForExpiry = ({
  orderId,

  expectedVersion,

  now = new Date(),

  session,
}) => {
  return Order.findOneAndUpdate(
    {
      _id: orderId,

      status: ORDER_STATUSES.PENDING,

      "payment.method": ORDER_PAYMENT_METHODS.ONLINE,

      "payment.status": ORDER_PAYMENT_STATUSES.PENDING,

      inventoryStatus: ORDER_INVENTORY_STATUSES.RESERVED,

      inventoryReservationVersion: expectedVersion,

      inventoryReservationExpiresAt: {
        $ne: null,

        $lte: now,
      },
    },

    {
      $inc: {
        inventoryReservationVersion: 1,
      },
    },

    {
      returnDocument: "after",

      session,

      runValidators: true,
    },
  );
};
