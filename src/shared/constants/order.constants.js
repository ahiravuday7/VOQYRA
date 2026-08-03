/*
|--------------------------------------------------------------------------
| Order Statuses
|--------------------------------------------------------------------------
*/

export const ORDER_STATUSES = Object.freeze({
  PENDING: "pending",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
});

export const ORDER_STATUS_VALUES = Object.freeze(Object.values(ORDER_STATUSES));

/*
|--------------------------------------------------------------------------
| Order Payment Statuses
|--------------------------------------------------------------------------
*/

export const ORDER_PAYMENT_STATUSES = Object.freeze({
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  PARTIALLY_REFUNDED: "partially-refunded",
  REFUNDED: "refunded",
});

export const ORDER_PAYMENT_STATUS_VALUES = Object.freeze(
  Object.values(ORDER_PAYMENT_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Order Payment Methods
|--------------------------------------------------------------------------
*/

export const ORDER_PAYMENT_METHODS = Object.freeze({
  CASH_ON_DELIVERY: "cash-on-delivery",

  ONLINE: "online",
});

export const ORDER_PAYMENT_METHOD_VALUES = Object.freeze(
  Object.values(ORDER_PAYMENT_METHODS),
);

/*
|--------------------------------------------------------------------------
| Order Inventory Statuses
|--------------------------------------------------------------------------
|
| PENDING:
| The Order exists but inventory has not yet been reserved.
|
| RESERVED:
| Inventory is temporarily held for the Order.
|
| COMMITTED:
| Reserved inventory has been converted into sold inventory.
|
| RELEASED:
| Reserved inventory was returned after cancellation or failure.
|--------------------------------------------------------------------------
*/

export const ORDER_INVENTORY_STATUSES = Object.freeze({
  PENDING: "pending",
  RESERVED: "reserved",
  COMMITTED: "committed",
  RELEASED: "released",
});

export const ORDER_INVENTORY_STATUS_VALUES = Object.freeze(
  Object.values(ORDER_INVENTORY_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Order Currency
|--------------------------------------------------------------------------
*/

export const ORDER_CURRENCIES = Object.freeze({
  INR: "INR",
});

export const ORDER_CURRENCY_VALUES = Object.freeze(
  Object.values(ORDER_CURRENCIES),
);

/*
|--------------------------------------------------------------------------
| Order Limits
|--------------------------------------------------------------------------
*/

export const MAX_ORDER_ITEMS = 100;

export const MAX_ORDER_ITEM_QUANTITY = 100;

/*
|--------------------------------------------------------------------------
| Order Status Transitions
|--------------------------------------------------------------------------
|
| These transitions will later be enforced by the Order service.
|--------------------------------------------------------------------------
*/

export const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUSES.PENDING]: Object.freeze([
    ORDER_STATUSES.CONFIRMED,
    ORDER_STATUSES.CANCELLED,
  ]),

  [ORDER_STATUSES.CONFIRMED]: Object.freeze([
    ORDER_STATUSES.PROCESSING,
    ORDER_STATUSES.CANCELLED,
  ]),

  [ORDER_STATUSES.PROCESSING]: Object.freeze([
    ORDER_STATUSES.SHIPPED,
    ORDER_STATUSES.CANCELLED,
  ]),

  [ORDER_STATUSES.SHIPPED]: Object.freeze([ORDER_STATUSES.DELIVERED]),

  [ORDER_STATUSES.DELIVERED]: Object.freeze([ORDER_STATUSES.REFUNDED]),

  [ORDER_STATUSES.CANCELLED]: Object.freeze([]),

  [ORDER_STATUSES.REFUNDED]: Object.freeze([]),
});
