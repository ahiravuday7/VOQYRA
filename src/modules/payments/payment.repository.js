import PaymentTransaction, {
  PAYMENT_TRANSACTION_STATUSES,
} from "./payment.model.js";

/*
|--------------------------------------------------------------------------
| Active Payment Attempt Statuses
|--------------------------------------------------------------------------
|
| Any of these means:
|
| Do NOT create another payment attempt.
|--------------------------------------------------------------------------
*/

const ACTIVE_PAYMENT_TRANSACTION_STATUS_VALUES = Object.freeze([
  PAYMENT_TRANSACTION_STATUSES.CREATED,

  PAYMENT_TRANSACTION_STATUSES.PENDING,

  PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,
]);

/*
|--------------------------------------------------------------------------
| Successful Payment Statuses
|--------------------------------------------------------------------------
*/

const SUCCESSFUL_PAYMENT_TRANSACTION_STATUS_VALUES = Object.freeze([
  PAYMENT_TRANSACTION_STATUSES.PAID,

  PAYMENT_TRANSACTION_STATUSES.PARTIALLY_REFUNDED,

  PAYMENT_TRANSACTION_STATUSES.REFUNDED,
]);

/*
|--------------------------------------------------------------------------
| Find Latest Payment Transaction
|--------------------------------------------------------------------------
*/

export const findLatestPaymentTransactionForOrder = (
  orderId,
  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    order: orderId,
  })
    .sort({
      attemptNumber: -1,
    })
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Active Payment Transaction
|--------------------------------------------------------------------------
|
| Used for idempotency.
|
| Example:
|
| Customer double-clicks "Pay":
|
| request #1 → existing pending payment
| request #2 → same payment should be reused
|
| NOT another provider payment.
|--------------------------------------------------------------------------
*/

export const findActivePaymentTransactionForOrder = (
  orderId,
  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    order: orderId,

    status: {
      $in: ACTIVE_PAYMENT_TRANSACTION_STATUS_VALUES,
    },
  })
    .sort({
      attemptNumber: -1,
    })
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Successful Payment Transaction
|--------------------------------------------------------------------------
|
| Defensive reconciliation check:
|
| If a successful PaymentTransaction exists but Order.payment still says
| pending, do NOT create another payment and risk double charging.
|--------------------------------------------------------------------------
*/

export const findSuccessfulPaymentTransactionForOrder = (
  orderId,
  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    order: orderId,

    status: {
      $in: SUCCESSFUL_PAYMENT_TRANSACTION_STATUS_VALUES,
    },
  })
    .sort({
      attemptNumber: -1,
    })
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Create Payment Transaction
|--------------------------------------------------------------------------
|
| Single-document insertion is atomic.
|
| Database unique indexes provide the final concurrency protection for:
|
| paymentNumber
| order + attemptNumber
|--------------------------------------------------------------------------
*/

export const createPaymentTransactionDocument = async (
  paymentData,
  { session = null } = {},
) => {
  const paymentTransaction = new PaymentTransaction(paymentData);

  if (session) {
    await paymentTransaction.save({
      session,
    });
  } else {
    await paymentTransaction.save();
  }

  return paymentTransaction;
};

/*
|--------------------------------------------------------------------------
| Find Payment Transaction By Order + Attempt
|--------------------------------------------------------------------------
|
| Useful when concurrent requests collide on the unique:
|
| order + attemptNumber
|
| index.
|--------------------------------------------------------------------------
*/

export const findPaymentTransactionByOrderAndAttemptNumber = (
  orderId,
  attemptNumber,
  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    order: orderId,

    attemptNumber,
  }).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Payment Transaction By Payment Number
|--------------------------------------------------------------------------
*/

export const findPaymentTransactionByPaymentNumber = (
  paymentNumber,
  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    paymentNumber,
  }).lean();

  if (session) {
    query.session(session);
  }

  return query;
};
