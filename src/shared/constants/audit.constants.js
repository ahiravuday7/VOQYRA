/*
|--------------------------------------------------------------------------
| Audit Actor Types
|--------------------------------------------------------------------------
*/

export const AUDIT_ACTOR_TYPES = Object.freeze({
  USER: "user",

  SYSTEM: "system",
});

export const AUDIT_ACTOR_TYPE_VALUES = Object.freeze(
  Object.values(AUDIT_ACTOR_TYPES),
);

/*
|--------------------------------------------------------------------------
| System Audit Actors
|--------------------------------------------------------------------------
|
| Stable identifiers for automated backend processes.
|--------------------------------------------------------------------------
*/

export const SYSTEM_AUDIT_ACTORS = Object.freeze({
  ORDER_RESERVATION_EXPIRY: "order-reservation-expiry-worker",

  PAYMENT_WEBHOOK_WORKER: "payment-webhook-worker",
});

export const SYSTEM_AUDIT_ACTOR_VALUES = Object.freeze(
  Object.values(SYSTEM_AUDIT_ACTORS),
);
