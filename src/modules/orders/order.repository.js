import Order from "./order.model.js";

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
