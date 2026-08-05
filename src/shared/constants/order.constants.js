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
*/

export const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUSES.PENDING]: Object.freeze([
    ORDER_STATUSES.CONFIRMED,
    ORDER_STATUSES.CANCELLED,
  ]),

  [ORDER_STATUSES.CONFIRMED]: Object.freeze([ORDER_STATUSES.PROCESSING]),

  [ORDER_STATUSES.PROCESSING]: Object.freeze([ORDER_STATUSES.SHIPPED]),

  [ORDER_STATUSES.SHIPPED]: Object.freeze([ORDER_STATUSES.DELIVERED]),

  [ORDER_STATUSES.DELIVERED]: Object.freeze([ORDER_STATUSES.REFUNDED]),

  [ORDER_STATUSES.CANCELLED]: Object.freeze([]),

  [ORDER_STATUSES.REFUNDED]: Object.freeze([]),
});

/*
|--------------------------------------------------------------------------
| Customer Order Cancellation States
|--------------------------------------------------------------------------
|
| Customers may cancel only before Order processing or shipment begins.
|--------------------------------------------------------------------------
*/

export const CUSTOMER_CANCELLABLE_ORDER_STATUS_VALUES = Object.freeze([
  ORDER_STATUSES.PENDING,
  ORDER_STATUSES.CONFIRMED,
]);

export const CUSTOMER_CANCELLABLE_PAYMENT_STATUS_VALUES = Object.freeze([
  ORDER_PAYMENT_STATUSES.PENDING,
  ORDER_PAYMENT_STATUSES.FAILED,
]);

/*
|--------------------------------------------------------------------------
| Order Status Transition Actions
|--------------------------------------------------------------------------
*/

export const ORDER_STATUS_TRANSITION_ACTIONS = Object.freeze({
  NONE: "none",

  COMMIT_RESERVED_INVENTORY: "commit-reserved-inventory",

  RELEASE_RESERVED_INVENTORY: "release-reserved-inventory",

  REQUIRE_SHIPMENT: "require-shipment",

  REQUIRE_DELIVERY: "require-delivery",

  REQUIRE_REFUND: "require-refund",
});

/*
|--------------------------------------------------------------------------
| Order Status Transition Action Map
|--------------------------------------------------------------------------
*/

export const ORDER_STATUS_TRANSITION_ACTION_MAP = Object.freeze({
  [`${ORDER_STATUSES.PENDING}:${ORDER_STATUSES.CONFIRMED}`]:
    ORDER_STATUS_TRANSITION_ACTIONS.COMMIT_RESERVED_INVENTORY,

  [`${ORDER_STATUSES.PENDING}:${ORDER_STATUSES.CANCELLED}`]:
    ORDER_STATUS_TRANSITION_ACTIONS.RELEASE_RESERVED_INVENTORY,

  [`${ORDER_STATUSES.CONFIRMED}:${ORDER_STATUSES.PROCESSING}`]:
    ORDER_STATUS_TRANSITION_ACTIONS.NONE,

  [`${ORDER_STATUSES.PROCESSING}:${ORDER_STATUSES.SHIPPED}`]:
    ORDER_STATUS_TRANSITION_ACTIONS.REQUIRE_SHIPMENT,

  [`${ORDER_STATUSES.SHIPPED}:${ORDER_STATUSES.DELIVERED}`]:
    ORDER_STATUS_TRANSITION_ACTIONS.REQUIRE_DELIVERY,

  [`${ORDER_STATUSES.DELIVERED}:${ORDER_STATUSES.REFUNDED}`]:
    ORDER_STATUS_TRANSITION_ACTIONS.REQUIRE_REFUND,
});

/*
|--------------------------------------------------------------------------
| Order Return Statuses
|--------------------------------------------------------------------------
*/

export const ORDER_RETURN_STATUSES = Object.freeze({
  REQUESTED: "requested",

  APPROVED: "approved",

  REJECTED: "rejected",

  IN_TRANSIT: "in-transit",

  RECEIVED: "received",

  INSPECTED: "inspected",

  COMPLETED: "completed",

  CANCELLED: "cancelled",
});

export const ORDER_RETURN_STATUS_VALUES = Object.freeze(
  Object.values(ORDER_RETURN_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Order Return Reasons
|--------------------------------------------------------------------------
*/

export const ORDER_RETURN_REASONS = Object.freeze({
  DAMAGED: "damaged",

  DEFECTIVE: "defective",

  WRONG_ITEM: "wrong-item",

  SIZE_ISSUE: "size-issue",

  COLOR_ISSUE: "color-issue",

  QUALITY_ISSUE: "quality-issue",

  NOT_AS_DESCRIBED: "not-as-described",

  CHANGED_MIND: "changed-mind",

  OTHER: "other",
});

export const ORDER_RETURN_REASON_VALUES = Object.freeze(
  Object.values(ORDER_RETURN_REASONS),
);

/*
|--------------------------------------------------------------------------
| Order Return Requested Resolutions
|--------------------------------------------------------------------------
|
| This value records what the customer wants.
|
| It does not automatically grant a refund or replacement.
|--------------------------------------------------------------------------
*/

export const ORDER_RETURN_RESOLUTIONS = Object.freeze({
  REFUND: "refund",

  REPLACEMENT: "replacement",
});

export const ORDER_RETURN_RESOLUTION_VALUES = Object.freeze(
  Object.values(ORDER_RETURN_RESOLUTIONS),
);

/*
|--------------------------------------------------------------------------
| Order Return Item Inspection Statuses
|--------------------------------------------------------------------------
*/

export const ORDER_RETURN_ITEM_INSPECTION_STATUSES = Object.freeze({
  PENDING: "pending",

  INSPECTED: "inspected",
});

export const ORDER_RETURN_ITEM_INSPECTION_STATUS_VALUES = Object.freeze(
  Object.values(ORDER_RETURN_ITEM_INSPECTION_STATUSES),
);
