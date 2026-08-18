import {
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

import { PAYMENT_TRANSACTION_STATUSES } from "./payment.model.js";

import {
  findPaymentTransactionById,
  recordPaymentReconciliationManualReview,
  recordPaymentReconciliationRecovered,
} from "./payment.repository.js";

import { findOrderById } from "../orders/order.repository.js";

import { finalizeCapturedCustomerOnlineOrder } from "./payment.service.js";

/*
|--------------------------------------------------------------------------
| Payment Reconciliation States
|--------------------------------------------------------------------------
|
| RECOVERABLE:
| Payment is trusted + paid, but the Order finalization did not complete.
|
| ALREADY_FINALIZED:
| Payment and Order are already consistent. No action required.
|
| MANUAL_REVIEW:
| Payment succeeded but the Order is in a state that is unsafe to mutate
| automatically.
|
| NOT_APPLICABLE:
| Transaction is not a paid transaction requiring reconciliation.
|--------------------------------------------------------------------------
*/

export const PAYMENT_RECONCILIATION_STATES = Object.freeze({
  RECOVERABLE: "recoverable",

  ALREADY_FINALIZED: "already-finalized",

  MANUAL_REVIEW: "manual-review",

  NOT_APPLICABLE: "not-applicable",
});

/*
|--------------------------------------------------------------------------
| Payment Reconciliation Actions
|--------------------------------------------------------------------------
*/

export const PAYMENT_RECONCILIATION_ACTIONS = Object.freeze({
  RECOVERED: "recovered",

  ALREADY_FINALIZED: "already-finalized",

  MANUAL_REVIEW: "manual-review",

  SKIPPED: "skipped",
});

/*
|--------------------------------------------------------------------------
| Payment Reconciliation Reasons
|--------------------------------------------------------------------------
*/

export const PAYMENT_RECONCILIATION_REASONS = Object.freeze({
  PAYMENT_TRANSACTION_NOT_FOUND: "payment-transaction-not-found",

  ORDER_NOT_FOUND: "order-not-found",

  PAYMENT_NOT_PAID: "payment-not-paid",

  PAYMENT_NOT_TRUSTED: "payment-not-trusted",

  PAYMENT_ORDER_MISMATCH: "payment-order-mismatch",

  PAYMENT_CUSTOMER_MISMATCH: "payment-customer-mismatch",

  PAYMENT_AMOUNT_MISMATCH: "payment-amount-mismatch",

  PAYMENT_CURRENCY_MISMATCH: "payment-currency-mismatch",

  ORDER_REQUIRES_FINALIZATION: "order-requires-finalization",

  ORDER_ALREADY_FINALIZED: "order-already-finalized",

  ORDER_STATE_CONFLICT: "order-state-conflict",
});

/*
|--------------------------------------------------------------------------
| Finalized Order Statuses
|--------------------------------------------------------------------------
|
| Once online-payment finalization succeeds the Order initially becomes
| confirmed.
|
| By the time reconciliation runs it may already have progressed to:
|
| processing
| shipped
| delivered
|--------------------------------------------------------------------------
*/

const FINALIZED_ORDER_STATUS_SET = new Set([
  ORDER_STATUSES.CONFIRMED,

  ORDER_STATUSES.PROCESSING,

  ORDER_STATUSES.SHIPPED,

  ORDER_STATUSES.DELIVERED,
]);

/*
|--------------------------------------------------------------------------
| Normalize Identifier
|--------------------------------------------------------------------------
*/

const normalizeIdentifier = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Trusted Paid Payment
|--------------------------------------------------------------------------
*/

const isTrustedPaidPaymentTransaction = (paymentTransaction) => {
  if (paymentTransaction.status !== PAYMENT_TRANSACTION_STATUSES.PAID) {
    return false;
  }

  if (!paymentTransaction.paidAt) {
    return false;
  }

  const hasTrustedVerification = Boolean(
    paymentTransaction.verifiedAt || paymentTransaction.providerVerifiedAt,
  );

  if (!hasTrustedVerification) {
    return false;
  }

  if (!paymentTransaction.provider) {
    return false;
  }

  if (!paymentTransaction.providerReference?.orderId) {
    return false;
  }

  if (!paymentTransaction.providerReference?.paymentId) {
    return false;
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| Classify Payment / Order Reconciliation State
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| This function performs no database writes.
|
| It only decides whether the mismatch is:
|
| safe to recover automatically,
| already completed,
| or unsafe and requires manual review.
|--------------------------------------------------------------------------
*/

export const classifyPaymentOrderReconciliationState = ({
  order,

  paymentTransaction,
}) => {
  if (!order?._id) {
    throw new Error("Payment reconciliation requires an Order");
  }

  if (!paymentTransaction?._id) {
    throw new Error("Payment reconciliation requires a Payment transaction");
  }

  /*
  |--------------------------------------------------------------------------
  | Only Paid Transactions Are Part Of This Recovery Flow
  |--------------------------------------------------------------------------
  */

  if (paymentTransaction.status !== PAYMENT_TRANSACTION_STATUSES.PAID) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.NOT_APPLICABLE,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_NOT_PAID,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Trusted Payment Evidence
  |--------------------------------------------------------------------------
  |
  | Never automatically reconcile a Payment that merely says "paid"
  | without trusted provider/browser verification.
  |--------------------------------------------------------------------------
  */

  if (!isTrustedPaidPaymentTransaction(paymentTransaction)) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_NOT_TRUSTED,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Payment Must Belong To Order
  |--------------------------------------------------------------------------
  */

  if (
    normalizeIdentifier(paymentTransaction.order) !==
    normalizeIdentifier(order._id)
  ) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_ORDER_MISMATCH,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Payment Must Belong To Same Customer
  |--------------------------------------------------------------------------
  */

  if (
    normalizeIdentifier(paymentTransaction.customer) !==
    normalizeIdentifier(order.customer)
  ) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_CUSTOMER_MISMATCH,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Trusted Amount
  |--------------------------------------------------------------------------
  */

  const orderAmount = Number(order.totals?.grandTotal);

  const paymentAmount = Number(paymentTransaction.amount);

  if (
    !Number.isSafeInteger(orderAmount) ||
    !Number.isSafeInteger(paymentAmount) ||
    orderAmount !== paymentAmount
  ) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Trusted Currency
  |--------------------------------------------------------------------------
  */

  const orderCurrency = order.totals?.currency?.trim().toUpperCase();

  const paymentCurrency = paymentTransaction.currency?.trim().toUpperCase();

  if (!orderCurrency || !paymentCurrency || orderCurrency !== paymentCurrency) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_CURRENCY_MISMATCH,
    };
  }

  const providerPaymentId = paymentTransaction.providerReference.paymentId;

  /*
  |--------------------------------------------------------------------------
  | Already Finalized
  |--------------------------------------------------------------------------
  |
  | Reconciliation may discover an old successful Payment after the Order
  | has already progressed beyond confirmed.
  |--------------------------------------------------------------------------
  */

  const alreadyFinalized =
    FINALIZED_ORDER_STATUS_SET.has(order.status) &&
    order.payment?.method === ORDER_PAYMENT_METHODS.ONLINE &&
    order.payment?.status === ORDER_PAYMENT_STATUSES.PAID &&
    order.inventoryStatus === ORDER_INVENTORY_STATUSES.COMMITTED &&
    order.payment?.provider === paymentTransaction.provider &&
    order.payment?.transactionId === providerPaymentId;

  if (alreadyFinalized) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.ALREADY_FINALIZED,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_ALREADY_FINALIZED,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Safe Automatic Recovery State
  |--------------------------------------------------------------------------
  |
  | This is THE important Part 206 state:
  |
  | PaymentTransaction
  |   status = paid
  |
  | but Order still says:
  |
  |   status            = pending
  |   payment.method    = online
  |   payment.status    = pending
  |   inventoryStatus   = reserved
  |
  | Existing Part 191 finalization can safely be retried from here.
  |--------------------------------------------------------------------------
  */

  const canRecoverAutomatically =
    order.status === ORDER_STATUSES.PENDING &&
    order.payment?.method === ORDER_PAYMENT_METHODS.ONLINE &&
    order.payment?.status === ORDER_PAYMENT_STATUSES.PENDING &&
    order.inventoryStatus === ORDER_INVENTORY_STATUSES.RESERVED;

  if (canRecoverAutomatically) {
    return {
      state: PAYMENT_RECONCILIATION_STATES.RECOVERABLE,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_REQUIRES_FINALIZATION,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Unsafe Paid-Payment Mismatch
  |--------------------------------------------------------------------------
  |
  | Example:
  |
  | PaymentTransaction = paid
  |
  | Order = cancelled
  | inventory = released
  |
  | DO NOT automatically recreate reservations or commit stock.
  |
  | This requires operational/manual review and possibly refund handling.
  |--------------------------------------------------------------------------
  */

  return {
    state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

    reason: PAYMENT_RECONCILIATION_REASONS.ORDER_STATE_CONFLICT,
  };
};

/*
|--------------------------------------------------------------------------
| Reconcile Paid Payment Transaction
|--------------------------------------------------------------------------
|
| Reconciles ONE local PaymentTransaction.
|
| Important:
|
| Candidate discovery is only an optimization.
|
| This service loads PaymentTransaction + Order again before making any
| decision because their state may have changed after candidate discovery.
|
| Actual Order / inventory mutation is delegated to the existing atomic
| online-payment finalizer.
|--------------------------------------------------------------------------
*/

export const reconcilePaidPaymentTransaction = async (paymentTransactionId) => {
  if (!paymentTransactionId) {
    throw new Error("Payment transaction ID is required for reconciliation");
  }

  const attemptedAt = new Date();

  /*
  |--------------------------------------------------------------------------
  | Load Fresh PaymentTransaction
  |--------------------------------------------------------------------------
  */

  const paymentTransaction =
    await findPaymentTransactionById(paymentTransactionId);

  /*
  |--------------------------------------------------------------------------
  | Candidate May Have Disappeared
  |--------------------------------------------------------------------------
  |
  | A worker should not crash merely because a stale candidate was deleted.
  |--------------------------------------------------------------------------
  */

  if (!paymentTransaction) {
    return {
      action: PAYMENT_RECONCILIATION_ACTIONS.SKIPPED,

      classification: {
        state: PAYMENT_RECONCILIATION_STATES.NOT_APPLICABLE,

        reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_TRANSACTION_NOT_FOUND,
      },

      paymentTransaction: null,

      order: null,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Load Related Order
  |--------------------------------------------------------------------------
  |
  | We deliberately load by Order ID first.
  |
  | Do NOT query by Order + customer here because the classifier must still
  | be able to detect a customer mismatch as an unsafe state.
  |--------------------------------------------------------------------------
  */

  const order = paymentTransaction.order
    ? await findOrderById(paymentTransaction.order)
    : null;

  /*
  |--------------------------------------------------------------------------
  | Paid Payment Without Local Order
  |--------------------------------------------------------------------------
  |
  | This is NOT safe to auto-repair.
  |
  | A successful external payment may require refund / operational review.
  |--------------------------------------------------------------------------
  */

  if (!order) {
    const classification = {
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_NOT_FOUND,
    };

    const auditedPaymentTransaction =
      await recordPaymentReconciliationManualReview(
        paymentTransaction._id,

        {
          reason: classification.reason,

          attemptedAt,
        },
      );

    return {
      action: PAYMENT_RECONCILIATION_ACTIONS.MANUAL_REVIEW,

      classification,

      paymentTransaction: auditedPaymentTransaction ?? paymentTransaction,

      order: null,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Strict Fresh Classification
  |--------------------------------------------------------------------------
  */

  const classification = classifyPaymentOrderReconciliationState({
    order,

    paymentTransaction,
  });

  /*
  |--------------------------------------------------------------------------
  | Not Applicable
  |--------------------------------------------------------------------------
  */

  if (classification.state === PAYMENT_RECONCILIATION_STATES.NOT_APPLICABLE) {
    return {
      action: PAYMENT_RECONCILIATION_ACTIONS.SKIPPED,

      classification,

      paymentTransaction,

      order,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Unsafe State
  |--------------------------------------------------------------------------
  |
  | Examples:
  |
  | - paid Payment + cancelled Order
  | - amount mismatch
  | - currency mismatch
  | - customer mismatch
  | - untrusted Payment evidence
  |
  | Never mutate automatically.
  |--------------------------------------------------------------------------
  */

  if (classification.state === PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW) {
    const auditedPaymentTransaction =
      await recordPaymentReconciliationManualReview(
        paymentTransaction._id,

        {
          reason: classification.reason,

          attemptedAt,
        },
      );

    return {
      action: PAYMENT_RECONCILIATION_ACTIONS.MANUAL_REVIEW,

      classification,

      paymentTransaction: auditedPaymentTransaction ?? paymentTransaction,

      order,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Already Finalized
  |--------------------------------------------------------------------------
  */

  if (
    classification.state === PAYMENT_RECONCILIATION_STATES.ALREADY_FINALIZED
  ) {
    return {
      action: PAYMENT_RECONCILIATION_ACTIONS.ALREADY_FINALIZED,

      classification,

      paymentTransaction,

      order,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Recoverable Payment
  |--------------------------------------------------------------------------
  |
  | At this point:
  |
  | PaymentTransaction:
  |   paid + trusted
  |
  | Order:
  |   pending
  |   online
  |   payment pending
  |   inventory reserved
  |
  | IMPORTANT:
  |
  | We still do not directly update Order or Product inventory here.
  |--------------------------------------------------------------------------
  */

  const finalization = await finalizeCapturedCustomerOnlineOrder({
    orderId: order._id,

    paymentTransactionId: paymentTransaction._id,

    customerId: paymentTransaction.customer,
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Finalization Can Produce Reuse
  |--------------------------------------------------------------------------
  |
  | The existing finalizer is idempotent.
  |
  | Another request may have finalized the Order after our classification
  | but before this call acquired its transaction state.
  |--------------------------------------------------------------------------
  */

  if (finalization.action === "reuse") {
    return {
      action: PAYMENT_RECONCILIATION_ACTIONS.ALREADY_FINALIZED,

      classification,

      paymentTransaction: finalization.paymentTransaction,

      order: finalization.order,
    };
  }

  const recoveredAt = new Date();

  const auditedPaymentTransaction = await recordPaymentReconciliationRecovered(
    paymentTransaction._id,

    {
      reason: classification.reason,

      attemptedAt,

      recoveredAt,
    },
  );

  return {
    action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,

    classification,

    paymentTransaction:
      auditedPaymentTransaction ?? finalization.paymentTransaction,

    order: finalization.order,
  };
};
