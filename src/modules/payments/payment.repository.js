import PaymentTransaction, {
  PAYMENT_TRANSACTION_STATUSES,
  PAYMENT_RECONCILIATION_RECORD_STATUSES,
} from "./payment.model.js";

import Order from "../orders/order.model.js";

import {
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

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
| Find Recoverable Payment Reconciliation Candidates
|--------------------------------------------------------------------------
|
| Finds the narrow Part 206 recovery condition:
|
| PaymentTransaction
|   status = paid
|   trusted verification exists
|   provider references exist
|
| Order
|   status = pending
|   payment.method = online
|   payment.status = pending
|   inventoryStatus = reserved
|
| IMPORTANT:
|
| This function only identifies candidates.
|
| It does NOT:
|
| - finalize the Order
| - commit inventory
| - update PaymentTransaction
| - change Order state
|
| Every candidate must still be revalidated immediately before recovery.
|--------------------------------------------------------------------------
*/

export const findRecoverablePaymentReconciliationCandidates = ({
  limit = 50,
} = {}) => {
  /*
  |--------------------------------------------------------------------------
  | Bounded Query
  |--------------------------------------------------------------------------
  */

  const safeLimit = Math.min(
    Math.max(Number.isSafeInteger(limit) ? limit : 50, 1),
    100,
  );

  return PaymentTransaction.aggregate([
    /*
    |--------------------------------------------------------------------------
    | Trusted Paid Transactions
    |--------------------------------------------------------------------------
    */

    {
      $match: {
        status: PAYMENT_TRANSACTION_STATUSES.PAID,

        paidAt: {
          $ne: null,
        },

        "providerReference.orderId": {
          $type: "string",
          $ne: "",
        },

        "providerReference.paymentId": {
          $type: "string",
          $ne: "",
        },

        /*
    |--------------------------------------------------------------------------
    | Candidate Must Be Trusted AND Not Already Reconciled
    |--------------------------------------------------------------------------
    |
    | $and is required because we have two independent $or conditions:
    |
    | 1. Either verification path is acceptable.
    | 2. Reconciliation must either be new/default or from an older
    |    Payment document that predates reconciliation metadata.
    |--------------------------------------------------------------------------
    */

        $and: [
          {
            $or: [
              {
                verifiedAt: {
                  $ne: null,
                },
              },

              {
                providerVerifiedAt: {
                  $ne: null,
                },
              },
            ],
          },

          {
            $or: [
              {
                "reconciliation.status": {
                  $exists: false,
                },
              },

              {
                "reconciliation.status":
                  PAYMENT_RECONCILIATION_RECORD_STATUSES.NONE,
              },
            ],
          },
        ],
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Oldest Paid Candidate First
    |--------------------------------------------------------------------------
    |
    | Existing payment_status_history index starts with status + createdAt.
    |--------------------------------------------------------------------------
    */

    {
      $sort: {
        createdAt: 1,

        _id: 1,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Join The Related Order
    |--------------------------------------------------------------------------
    */

    {
      $lookup: {
        from: Order.collection.name,

        localField: "order",

        foreignField: "_id",

        as: "orderDocument",
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Payment Must Reference A Real Order
    |--------------------------------------------------------------------------
    */

    {
      $unwind: "$orderDocument",
    },

    /*
    |--------------------------------------------------------------------------
    | Order Still Requires Online-Payment Finalization
    |--------------------------------------------------------------------------
    */

    {
      $match: {
        "orderDocument.status": ORDER_STATUSES.PENDING,

        "orderDocument.payment.method": ORDER_PAYMENT_METHODS.ONLINE,

        "orderDocument.payment.status": ORDER_PAYMENT_STATUSES.PENDING,

        "orderDocument.inventoryStatus": ORDER_INVENTORY_STATUSES.RESERVED,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Bound Every Worker Cycle
    |--------------------------------------------------------------------------
    */

    {
      $limit: safeLimit,
    },

    /*
    |--------------------------------------------------------------------------
    | Candidate Metadata Only
    |--------------------------------------------------------------------------
    |
    | The recovery service will load fresh documents again before mutation.
    |--------------------------------------------------------------------------
    */

    {
      $project: {
        _id: 1,

        paymentNumber: 1,

        order: 1,

        orderNumber: 1,

        customer: 1,

        provider: 1,

        amount: 1,

        currency: 1,

        paidAt: 1,

        createdAt: 1,

        providerReference: {
          orderId: "$providerReference.orderId",

          paymentId: "$providerReference.paymentId",
        },
      },
    },
  ]);
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

/*
|--------------------------------------------------------------------------
| Find Customer Payment Transaction For Confirmation
|--------------------------------------------------------------------------
|
| Ownership is enforced directly in the database query.
|--------------------------------------------------------------------------
*/

export const findCustomerPaymentTransactionForConfirmation = (
  paymentTransactionId,

  orderId,

  customerId,

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    _id: paymentTransactionId,

    order: orderId,

    customer: customerId,
  })
    .select("+providerReference.signature")
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Record Verified Provider Confirmation
|--------------------------------------------------------------------------
|
| Important:
|
| status remains PENDING.
|
| We are only recording that Checkout confirmation passed server-side
| signature verification.
|--------------------------------------------------------------------------
*/

export const recordVerifiedPaymentProviderConfirmation = (
  paymentTransactionId,

  {
    orderId,

    customerId,

    provider,

    providerOrderId,

    providerPaymentId,

    signature,

    verifiedAt,
  },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      order: orderId,

      customer: customerId,

      provider,

      status: {
        $in: [
          PAYMENT_TRANSACTION_STATUSES.PENDING,

          PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,

          PAYMENT_TRANSACTION_STATUSES.PAID,
        ],
      },

      "providerReference.orderId": providerOrderId,

      verifiedAt: null,

      $or: [
        {
          "providerReference.paymentId": null,
        },

        {
          "providerReference.paymentId": {
            $exists: false,
          },
        },

        {
          "providerReference.paymentId": providerPaymentId,
        },
      ],
    },

    {
      $set: {
        "providerReference.paymentId": providerPaymentId,

        "providerReference.signature": signature,

        verifiedAt,
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
| Mark Verified Payment Transaction Authorized
|--------------------------------------------------------------------------
|
| Atomic transition:
|
| pending
|    ↓
| authorized
|
| The transaction must already:
|
| - belong to the customer/order
| - have verified Checkout confirmation
| - contain the exact trusted provider Order ID
| - contain the exact trusted provider Payment ID
|--------------------------------------------------------------------------
*/

export const markVerifiedPaymentTransactionAuthorized = (
  paymentTransactionId,

  {
    orderId,

    customerId,

    provider,

    providerOrderId,

    providerPaymentId,

    authorizedAt,
  },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      order: orderId,

      customer: customerId,

      provider,

      status: PAYMENT_TRANSACTION_STATUSES.PENDING,

      $or: [
        {
          verifiedAt: {
            $ne: null,
          },
        },

        {
          providerVerifiedAt: {
            $ne: null,
          },
        },
      ],

      "providerReference.orderId": providerOrderId,

      "providerReference.paymentId": providerPaymentId,
    },

    {
      $set: {
        status: PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,

        authorizedAt,
      },
    },

    {
      new: true,

      runValidators: true,
    },
  )
    .select("+providerReference.signature")
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Mark Verified Payment Transaction Paid
|--------------------------------------------------------------------------
|
| Allowed transitions:
|
| pending
|    ↓
| paid
|
| OR:
|
| authorized
|    ↓
| paid
|
| This handles Razorpay automatic capture as well as a later capture.
|--------------------------------------------------------------------------
*/

export const markVerifiedPaymentTransactionPaid = (
  paymentTransactionId,

  {
    orderId,

    customerId,

    provider,

    providerOrderId,

    providerPaymentId,

    paidAt,
  },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      order: orderId,

      customer: customerId,

      provider,

      status: {
        $in: [
          PAYMENT_TRANSACTION_STATUSES.PENDING,

          PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,
        ],
      },

      $or: [
        {
          verifiedAt: {
            $ne: null,
          },
        },

        {
          providerVerifiedAt: {
            $ne: null,
          },
        },
      ],

      "providerReference.orderId": providerOrderId,

      "providerReference.paymentId": providerPaymentId,
    },

    {
      $set: {
        status: PAYMENT_TRANSACTION_STATUSES.PAID,

        paidAt,
      },
    },

    {
      new: true,

      runValidators: true,
    },
  )
    .select("+providerReference.signature")
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Payment Transaction By Provider Order
|--------------------------------------------------------------------------
|
| Webhooks do not know our MongoDB Order ID or PaymentTransaction ID.
|
| Razorpay does give us its trusted Order reference.
|--------------------------------------------------------------------------
*/

export const findPaymentTransactionByProviderOrderReference = (
  provider,

  providerOrderId,

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    provider,

    "providerReference.orderId": providerOrderId,
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
| Record Direct Provider Verification
|--------------------------------------------------------------------------
|
| Browser confirmation may never happen.
|
| After Part 189 successfully fetches and verifies the Payment directly
| from Razorpay, we can safely attach providerPaymentId and record:
|
| providerVerifiedAt
|--------------------------------------------------------------------------
*/

export const recordProviderVerifiedPaymentReference = (
  paymentTransactionId,

  {
    provider,

    providerOrderId,

    providerPaymentId,

    providerVerifiedAt,
  },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      provider,

      "providerReference.orderId": providerOrderId,

      providerVerifiedAt: null,

      $or: [
        {
          "providerReference.paymentId": null,
        },

        {
          "providerReference.paymentId": {
            $exists: false,
          },
        },

        {
          "providerReference.paymentId": providerPaymentId,
        },
      ],
    },

    {
      $set: {
        "providerReference.paymentId": providerPaymentId,

        providerVerifiedAt,
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
| Mark Trusted Provider Payment Failed
|--------------------------------------------------------------------------
|
| Payment attempt failed.
|
| Order remains:
|
| pending
| inventory reserved
|
| This lets the customer safely create another payment attempt against the
| same Order.
|--------------------------------------------------------------------------
*/

export const markTrustedPaymentTransactionFailed = (
  paymentTransactionId,

  {
    provider,

    providerOrderId,

    providerPaymentId,

    failedAt,
  },

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      provider,

      status: {
        $in: [
          PAYMENT_TRANSACTION_STATUSES.PENDING,

          PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,
        ],
      },

      "providerReference.orderId": providerOrderId,

      "providerReference.paymentId": providerPaymentId,

      $or: [
        {
          verifiedAt: {
            $ne: null,
          },
        },

        {
          providerVerifiedAt: {
            $ne: null,
          },
        },
      ],
    },

    {
      $set: {
        status: PAYMENT_TRANSACTION_STATUSES.FAILED,

        failure: {
          code: "PROVIDER_PAYMENT_FAILED",

          message: "Payment provider reported that the Payment failed",

          source: provider,

          step: "payment",

          reason: "provider-reported-failed",

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
| Payment States That Block Order Expiry
|--------------------------------------------------------------------------
|
| An authorized Payment may still become captured.
|
| Never release its Order reservation automatically.
|--------------------------------------------------------------------------
*/

const ORDER_EXPIRY_BLOCKING_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,

  PAYMENT_TRANSACTION_STATUSES.PAID,

  PAYMENT_TRANSACTION_STATUSES.PARTIALLY_REFUNDED,

  PAYMENT_TRANSACTION_STATUSES.REFUNDED,
]);

/*
|--------------------------------------------------------------------------
| Find Payment Blocking Reservation Expiry
|--------------------------------------------------------------------------
*/

export const findPaymentTransactionBlockingOrderExpiry = (
  orderId,

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOne({
    order: orderId,

    status: {
      $in: ORDER_EXPIRY_BLOCKING_PAYMENT_STATUSES,
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
| Cancel Open Payment Attempts For Expired Order
|--------------------------------------------------------------------------
|
| created / initializing / pending
|
| become:
|
| cancelled
|--------------------------------------------------------------------------
*/

export const cancelOpenPaymentTransactionsForExpiredOrder = (
  orderId,

  {
    cancelledAt = new Date(),

    session = null,
  } = {},
) => {
  return PaymentTransaction.updateMany(
    {
      order: orderId,

      status: {
        $in: [
          PAYMENT_TRANSACTION_STATUSES.CREATED,

          PAYMENT_TRANSACTION_STATUSES.INITIALIZING,

          PAYMENT_TRANSACTION_STATUSES.PENDING,
        ],
      },
    },

    {
      $set: {
        status: PAYMENT_TRANSACTION_STATUSES.CANCELLED,

        cancelledAt,
      },
    },

    {
      session,

      runValidators: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Record Successful Payment Reconciliation
|--------------------------------------------------------------------------
|
| Durable audit for:
|
| PaymentTransaction = paid
| Order finalization was previously incomplete
| reconciliation successfully repaired the Order
|
| detectedAt is preserved once first recorded.
| attemptCount increments atomically.
|--------------------------------------------------------------------------
*/

export const recordPaymentReconciliationRecovered = (
  paymentTransactionId,

  {
    reason,

    attemptedAt = new Date(),

    recoveredAt = attemptedAt,
  } = {},

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      status: PAYMENT_TRANSACTION_STATUSES.PAID,
    },

    [
      {
        $set: {
          "reconciliation.status":
            PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED,

          "reconciliation.reason": reason ?? null,

          "reconciliation.detectedAt": {
            $ifNull: ["$reconciliation.detectedAt", attemptedAt],
          },

          "reconciliation.lastAttemptedAt": attemptedAt,

          "reconciliation.attemptCount": {
            $add: [
              {
                $ifNull: ["$reconciliation.attemptCount", 0],
              },

              1,
            ],
          },

          "reconciliation.recoveredAt": recoveredAt,
        },
      },
    ],

    {
      new: true,
      updatePipeline: true,
    },
  ).lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Record Payment Reconciliation Manual Review
|--------------------------------------------------------------------------
|
| A paid Payment exists but automatically modifying the related Order is
| unsafe.
|
| Important:
|
| Never downgrade an already recovered reconciliation record back to
| manual-review.
|--------------------------------------------------------------------------
*/

export const recordPaymentReconciliationManualReview = (
  paymentTransactionId,

  {
    reason,

    attemptedAt = new Date(),
  } = {},

  { session = null } = {},
) => {
  const query = PaymentTransaction.findOneAndUpdate(
    {
      _id: paymentTransactionId,

      status: PAYMENT_TRANSACTION_STATUSES.PAID,

      "reconciliation.status": {
        $ne: PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED,
      },
    },

    [
      {
        $set: {
          "reconciliation.status":
            PAYMENT_RECONCILIATION_RECORD_STATUSES.MANUAL_REVIEW,

          "reconciliation.reason": reason ?? null,

          "reconciliation.detectedAt": {
            $ifNull: ["$reconciliation.detectedAt", attemptedAt],
          },

          "reconciliation.lastAttemptedAt": attemptedAt,

          "reconciliation.attemptCount": {
            $add: [
              {
                $ifNull: ["$reconciliation.attemptCount", 0],
              },

              1,
            ],
          },

          "reconciliation.recoveredAt": null,
        },
      },
    ],

    {
      new: true,
      updatePipeline: true,
    },
  ).lean();

  if (session) {
    query.session(session);
  }

  return query;
};
