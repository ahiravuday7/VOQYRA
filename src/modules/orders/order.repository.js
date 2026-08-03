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
