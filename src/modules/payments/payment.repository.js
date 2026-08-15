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

  PAYMENT_TRANSACTION_STATUSES.INITIALIZING,

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

/*
|--------------------------------------------------------------------------
| Attach Provider Order To Payment Transaction
|--------------------------------------------------------------------------
|
| Provider session creation changes:
|
| created
|
| into:
|
| pending
|
| and permanently records the external provider Order ID.
|--------------------------------------------------------------------------
*/

export const attachPaymentProviderOrderToTransaction = (
  paymentTransactionId,

  {
    provider,

    providerOrderId,
  },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      provider,

      status: PAYMENT_TRANSACTION_STATUSES.INITIALIZING,

      $or: [
        {
          "providerReference.orderId": null,
        },

        {
          "providerReference.orderId": {
            $exists: false,
          },
        },
      ],
    },

    {
      $set: {
        "providerReference.orderId": providerOrderId,

        status: PAYMENT_TRANSACTION_STATUSES.PENDING,
      },
    },

    {
      new: true,

      runValidators: true,
    },
  ).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Mark Provider Session Creation Failed
|--------------------------------------------------------------------------
|
| This is used only when the external provider did NOT create a usable
| payment session.
|
| Once failed, the PaymentTransaction no longer blocks a future retry.
|--------------------------------------------------------------------------
*/

export const markPaymentProviderSessionCreationFailed = (
  paymentTransactionId,

  {
    code,

    message,

    source,

    step,

    reason,
  },

  { session = null } = {},
) => {
  const failedAt = new Date();

  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      status: PAYMENT_TRANSACTION_STATUSES.INITIALIZING,

      $or: [
        {
          "providerReference.orderId": null,
        },

        {
          "providerReference.orderId": {
            $exists: false,
          },
        },
      ],
    },

    {
      $set: {
        status: PAYMENT_TRANSACTION_STATUSES.FAILED,

        failure: {
          code: code ?? null,

          message: message ?? null,

          source: source ?? null,

          step: step ?? null,

          reason: reason ?? null,

          failedAt,
        },
      },
    },

    {
      new: true,

      runValidators: true,
    },
  ).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Payment Transaction By ID
|--------------------------------------------------------------------------
*/

export const findPaymentTransactionById = (
  paymentTransactionId,
  { session = null } = {},
) => {
  const query = PaymentTransaction.findById(paymentTransactionId).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Claim Payment Transaction For Provider Initialization
|--------------------------------------------------------------------------
|
| Atomic transition:
|
| created -> initializing
|
| Only one request can win this update.
|--------------------------------------------------------------------------
*/

export const claimPaymentTransactionForProviderSession = (
  paymentTransactionId,

  { provider },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      provider,

      status: PAYMENT_TRANSACTION_STATUSES.CREATED,

      $or: [
        {
          "providerReference.orderId": null,
        },

        {
          "providerReference.orderId": {
            $exists: false,
          },
        },
      ],
    },

    {
      $set: {
        status: PAYMENT_TRANSACTION_STATUSES.INITIALIZING,
      },
    },

    {
      new: true,

      runValidators: true,
    },
  ).lean();

  if (session) {
    query.session(session);
  }

  return query;
};
