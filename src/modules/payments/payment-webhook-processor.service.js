import {
  PAYMENT_PROVIDERS,
  PAYMENT_TRANSACTION_STATUSES,
} from "./payment.model.js";

import {
  findPaymentTransactionByProviderOrderReference,
  recordProviderVerifiedPaymentReference,
  markTrustedPaymentTransactionFailed,
  findOtherSuccessfulPaymentTransactionForOrder,
  markFailedPaymentTransactionLateCaptured,
  recordPaymentReconciliationManualReview,
  markCancelledPaymentTransactionLateCaptured,
} from "./payment.repository.js";

import { findOrderById } from "../orders/order.repository.js";

import {
  ORDER_INVENTORY_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

import {
  AUDIT_ACTOR_TYPES,
  SYSTEM_AUDIT_ACTORS,
} from "../../shared/constants/audit.constants.js";

import { PAYMENT_RECONCILIATION_REASONS } from "./payment-reconciliation.service.js";

import { fetchAndVerifyPaymentProviderDetails } from "./providers/payment-provider.service.js";

import {
  synchronizeCustomerPaymentProviderState,
  finalizeCapturedCustomerOnlineOrder,
} from "./payment.service.js";

import {
  claimNextPaymentWebhookEvent,
  markPaymentWebhookEventProcessed,
  markPaymentWebhookEventFailed,
  deadLetterExhaustedPaymentWebhookEvents,
  markPaymentWebhookEventDeadLettered,
} from "./payment-webhook.repository.js";

/*
|--------------------------------------------------------------------------
| Worker Configuration
|--------------------------------------------------------------------------
*/

const PAYMENT_WEBHOOK_MAX_ATTEMPTS = 8;

const PAYMENT_WEBHOOK_STALE_CLAIM_MS = 5 * 60 * 1000;

const PAYMENT_WEBHOOK_MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Retry Delay
|--------------------------------------------------------------------------
|
| attempt 1 → 2 sec
| attempt 2 → 4 sec
| attempt 3 → 8 sec
| ...
| capped at 1 hour
|--------------------------------------------------------------------------
*/

const getWebhookRetryDelayMs = (processingAttempts) => {
  const exponent = Math.max(
    processingAttempts - 1,

    0,
  );

  return Math.min(
    2_000 * 2 ** exponent,

    PAYMENT_WEBHOOK_MAX_RETRY_DELAY_MS,
  );
};

/*
|--------------------------------------------------------------------------
| Internal Processing Error
|--------------------------------------------------------------------------
*/

const createWebhookProcessingError = (
  message,

  code,
) => {
  const error = new Error(message);

  error.code = code;

  return error;
};

/*
|--------------------------------------------------------------------------
| Ensure Provider Payment Identity
|--------------------------------------------------------------------------
*/

const ensureProviderVerifiedPaymentReference = async (
  paymentTransaction,

  providerPayment,
) => {
  /*
    |--------------------------------------------------------------------------
    | Existing Payment ID Conflict
    |--------------------------------------------------------------------------
    */

  const existingProviderPaymentId =
    paymentTransaction.providerReference?.paymentId;

  if (
    existingProviderPaymentId &&
    existingProviderPaymentId !== providerPayment.providerPaymentId
  ) {
    throw createWebhookProcessingError(
      "Payment transaction is already attached to another provider Payment",

      "PAYMENT_WEBHOOK_PROVIDER_PAYMENT_CONFLICT",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Already Provider Verified
    |--------------------------------------------------------------------------
    */

  if (
    paymentTransaction.providerVerifiedAt &&
    existingProviderPaymentId === providerPayment.providerPaymentId
  ) {
    return paymentTransaction;
  }

  /*
    |--------------------------------------------------------------------------
    | Record Direct Provider Verification
    |--------------------------------------------------------------------------
    */

  const updated = await recordProviderVerifiedPaymentReference(
    paymentTransaction._id,

    {
      provider: paymentTransaction.provider,

      providerOrderId: providerPayment.providerOrderId,

      providerPaymentId: providerPayment.providerPaymentId,

      providerVerifiedAt: new Date(),
    },
  );

  if (updated) {
    return updated;
  }

  /*
    |--------------------------------------------------------------------------
    | Concurrent Resolution
    |--------------------------------------------------------------------------
    */

  const current = await findPaymentTransactionByProviderOrderReference(
    paymentTransaction.provider,

    providerPayment.providerOrderId,
  );

  if (
    current?.providerVerifiedAt &&
    current.providerReference?.paymentId === providerPayment.providerPaymentId
  ) {
    return current;
  }

  throw createWebhookProcessingError(
    "Unable to attach trusted provider Payment to PaymentTransaction",

    "PAYMENT_WEBHOOK_PROVIDER_REFERENCE_CONFLICT",
  );
};

/*
|--------------------------------------------------------------------------
| Process One Claimed Webhook Event
|--------------------------------------------------------------------------
*/

const processClaimedPaymentWebhookEvent = async (webhookEvent) => {
  /*
    |--------------------------------------------------------------------------
    | Locate Local PaymentTransaction
    |--------------------------------------------------------------------------
    |
    | We locate using the provider Order ID.
    |
    | The webhook might arrive milliseconds before the local provider session
    | write becomes visible, therefore "not found" is retryable.
    |--------------------------------------------------------------------------
    */

  const paymentTransaction =
    await findPaymentTransactionByProviderOrderReference(
      PAYMENT_PROVIDERS.RAZORPAY,

      webhookEvent.payment.providerOrderId,
    );

  if (!paymentTransaction) {
    throw createWebhookProcessingError(
      "PaymentTransaction for Razorpay Order was not found",

      "PAYMENT_WEBHOOK_PAYMENT_TRANSACTION_NOT_FOUND",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Part 189 — Fetch CURRENT Provider Truth
    |--------------------------------------------------------------------------
    |
    | Never use webhook.eventType as final state.
    |
    | Webhooks may arrive out of order.
    |--------------------------------------------------------------------------
    */

  const providerPayment = await fetchAndVerifyPaymentProviderDetails({
    provider: paymentTransaction.provider,

    providerPaymentId: webhookEvent.payment.providerPaymentId,

    providerOrderId: webhookEvent.payment.providerOrderId,

    amount: paymentTransaction.amount,

    currency: paymentTransaction.currency,
  });

  /*
    |--------------------------------------------------------------------------
    | Record Provider Verification
    |--------------------------------------------------------------------------
    */

  const verifiedPaymentTransaction =
    await ensureProviderVerifiedPaymentReference(
      paymentTransaction,

      providerPayment,
    );

  /*
    |--------------------------------------------------------------------------
    | Provider Currently Reports Failed
    |--------------------------------------------------------------------------
    */

  if (
    providerPayment.status === "failed" &&
    providerPayment.captured === false
  ) {
    /*
     * Already failed = idempotent success.
     */
    if (
      verifiedPaymentTransaction.status === PAYMENT_TRANSACTION_STATUSES.FAILED
    ) {
      return {
        action: "reuse-failed",

        paymentTransaction: verifiedPaymentTransaction,

        providerPayment,

        orderFinalization: null,
      };
    }

    /*
     * Never downgrade a successful payment.
     */
    if (
      [
        PAYMENT_TRANSACTION_STATUSES.PAID,

        PAYMENT_TRANSACTION_STATUSES.PARTIALLY_REFUNDED,

        PAYMENT_TRANSACTION_STATUSES.REFUNDED,
      ].includes(verifiedPaymentTransaction.status)
    ) {
      return {
        action: "reuse-success",

        paymentTransaction: verifiedPaymentTransaction,

        providerPayment,

        orderFinalization: null,
      };
    }

    const failedPaymentTransaction = await markTrustedPaymentTransactionFailed(
      verifiedPaymentTransaction._id,

      {
        provider: verifiedPaymentTransaction.provider,

        providerOrderId: providerPayment.providerOrderId,

        providerPaymentId: providerPayment.providerPaymentId,

        failedAt: new Date(),
      },
    );

    if (!failedPaymentTransaction) {
      throw createWebhookProcessingError(
        "Unable to mark provider Payment failed",

        "PAYMENT_WEBHOOK_FAILED_STATE_CONFLICT",
      );
    }

    return {
      action: "fail",

      paymentTransaction: failedPaymentTransaction,

      providerPayment,

      orderFinalization: null,
    };
  }

  /*
|--------------------------------------------------------------------------
| Previously Failed Payment Captured Late
|--------------------------------------------------------------------------
|
| Exceptional provider correction:
|
| local PaymentTransaction = failed
|
| but CURRENT trusted Razorpay state now says:
|
| status   = captured
| captured = true
|--------------------------------------------------------------------------
*/

  if (
    verifiedPaymentTransaction.status === PAYMENT_TRANSACTION_STATUSES.FAILED &&
    providerPayment.status === "captured" &&
    providerPayment.captured === true
  ) {
    const observedAt = new Date();

    /*
  |--------------------------------------------------------------------------
  | Record Financial Truth
  |--------------------------------------------------------------------------
  |
  | Razorpay says the customer was charged.
  |
  | The local PaymentTransaction must therefore no longer remain "failed".
  |--------------------------------------------------------------------------
  */

    let lateCapturedPayment = await markFailedPaymentTransactionLateCaptured(
      verifiedPaymentTransaction._id,

      {
        orderId: verifiedPaymentTransaction.order,

        customerId: verifiedPaymentTransaction.customer,

        provider: verifiedPaymentTransaction.provider,

        providerOrderId: providerPayment.providerOrderId,

        providerPaymentId: providerPayment.providerPaymentId,

        paidAt: observedAt,
      },
    );

    /*
  |--------------------------------------------------------------------------
  | Concurrent Resolution
  |--------------------------------------------------------------------------
  |
  | Another worker/request may have already performed the same exceptional
  | transition.
  |--------------------------------------------------------------------------
  */

    if (!lateCapturedPayment) {
      const current = await findPaymentTransactionByProviderOrderReference(
        verifiedPaymentTransaction.provider,

        providerPayment.providerOrderId,
      );

      const alreadyResolved =
        current?.status === PAYMENT_TRANSACTION_STATUSES.PAID &&
        current.providerReference?.paymentId ===
          providerPayment.providerPaymentId;

      if (!alreadyResolved) {
        throw createWebhookProcessingError(
          "Unable to record late captured provider Payment",

          "PAYMENT_WEBHOOK_LATE_CAPTURE_STATE_CONFLICT",
        );
      }

      lateCapturedPayment = current;
    }

    /*
  |--------------------------------------------------------------------------
  | Check For Another Successful Payment
  |--------------------------------------------------------------------------
  |
  | Example:
  |
  | attempt #1 = failed, then captures late
  | attempt #2 = already paid
  |
  | Both Payments are now financially successful.
  |
  | Only ONE of them may settle the Order.
  |--------------------------------------------------------------------------
  */

    const competingSuccessfulPayment =
      await findOtherSuccessfulPaymentTransactionForOrder(
        lateCapturedPayment.order,

        lateCapturedPayment._id,
      );

    if (competingSuccessfulPayment) {
      /*
    |--------------------------------------------------------------------------
    | Durable Manual Review
    |--------------------------------------------------------------------------
    |
    | Do NOT:
    |
    | - finalize the Order with the old payment
    | - replace Order.payment.transactionId
    | - commit inventory again
    |
    | Operations will normally need to investigate/refund the duplicate charge.
    |--------------------------------------------------------------------------
    */

      const auditedPaymentTransaction =
        await recordPaymentReconciliationManualReview(
          lateCapturedPayment._id,

          {
            reason:
              PAYMENT_RECONCILIATION_REASONS.LATE_CAPTURE_AFTER_ORDER_PAID,

            attemptedAt: observedAt,
          },
        );

      return {
        action: "late-capture-manual-review",

        paymentTransaction: auditedPaymentTransaction ?? lateCapturedPayment,

        providerPayment,

        orderFinalization: null,
      };
    }

    /*
  |--------------------------------------------------------------------------
  | No Competing Successful Payment
  |--------------------------------------------------------------------------
  |
  | Example:
  |
  | attempt #1 failed locally
  | no later payment succeeded
  | Razorpay now confirms attempt #1 was captured
  |
  | In this case the Payment may legitimately recover the Order.
  |--------------------------------------------------------------------------
  */

    const orderFinalization = await finalizeCapturedCustomerOnlineOrder({
      orderId: lateCapturedPayment.order,

      paymentTransactionId: lateCapturedPayment._id,

      customerId: lateCapturedPayment.customer,
    });

    return {
      action: orderFinalization.action,

      paymentTransaction:
        orderFinalization.paymentTransaction ?? lateCapturedPayment,

      providerPayment,

      orderFinalization,
    };
  }

  /*
|--------------------------------------------------------------------------
| Cancelled Payment Captured After Local Cancellation
|--------------------------------------------------------------------------
|
| Most importantly:
|
| reservation expiry may have already:
|
| - cancelled the Order
| - released inventory
| - cancelled this PaymentTransaction
|
| If Razorpay later says captured, financial truth must be recorded,
| but the expired Order must NEVER be automatically resurrected.
|--------------------------------------------------------------------------
*/

  if (
    verifiedPaymentTransaction.status ===
      PAYMENT_TRANSACTION_STATUSES.CANCELLED &&
    providerPayment.status === "captured" &&
    providerPayment.captured === true
  ) {
    const observedAt = new Date();

    /*
  |--------------------------------------------------------------------------
  | Record Financial Truth
  |--------------------------------------------------------------------------
  */

    let lateCapturedPayment = await markCancelledPaymentTransactionLateCaptured(
      verifiedPaymentTransaction._id,

      {
        orderId: verifiedPaymentTransaction.order,

        customerId: verifiedPaymentTransaction.customer,

        provider: verifiedPaymentTransaction.provider,

        providerOrderId: providerPayment.providerOrderId,

        providerPaymentId: providerPayment.providerPaymentId,

        paidAt: observedAt,
      },
    );

    /*
  |--------------------------------------------------------------------------
  | Concurrent Resolution
  |--------------------------------------------------------------------------
  */

    if (!lateCapturedPayment) {
      const current = await findPaymentTransactionByProviderOrderReference(
        verifiedPaymentTransaction.provider,

        providerPayment.providerOrderId,
      );

      const alreadyResolved =
        current?.status === PAYMENT_TRANSACTION_STATUSES.PAID &&
        current.providerReference?.paymentId ===
          providerPayment.providerPaymentId;

      if (!alreadyResolved) {
        throw createWebhookProcessingError(
          "Unable to record late captured cancelled Payment",

          "PAYMENT_WEBHOOK_CANCELLED_LATE_CAPTURE_STATE_CONFLICT",
        );
      }

      lateCapturedPayment = current;
    }

    /*
  |--------------------------------------------------------------------------
  | Inspect Current Order
  |--------------------------------------------------------------------------
  */

    const order = await findOrderById(lateCapturedPayment.order);

    /*
  |--------------------------------------------------------------------------
  | Choose Durable Manual Review Reason
  |--------------------------------------------------------------------------
  */

    let reconciliationReason =
      PAYMENT_RECONCILIATION_REASONS.ORDER_STATE_CONFLICT;

    if (!order) {
      reconciliationReason = PAYMENT_RECONCILIATION_REASONS.ORDER_NOT_FOUND;
    } else if (wasOrderAutomaticallyExpired(order)) {
      reconciliationReason =
        PAYMENT_RECONCILIATION_REASONS.LATE_CAPTURE_AFTER_RESERVATION_EXPIRED;
    }

    /*
  |--------------------------------------------------------------------------
  | Manual Review Only
  |--------------------------------------------------------------------------
  |
  | Even if this was some other kind of cancelled Payment rather than
  | automatic expiry, CANCELLED → CAPTURED is unsafe for automatic Order
  | finalization.
  |--------------------------------------------------------------------------
  */

    const auditedPaymentTransaction =
      await recordPaymentReconciliationManualReview(
        lateCapturedPayment._id,

        {
          reason: reconciliationReason,

          attemptedAt: observedAt,
        },
      );

    return {
      action: "late-capture-manual-review",

      paymentTransaction: auditedPaymentTransaction ?? lateCapturedPayment,

      providerPayment,

      orderFinalization: null,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Parts 190 — Synchronize Current Provider State
    |--------------------------------------------------------------------------
    */

  const synchronization = await synchronizeCustomerPaymentProviderState({
    orderId: verifiedPaymentTransaction.order,

    paymentTransactionId: verifiedPaymentTransaction._id,

    customerId: verifiedPaymentTransaction.customer,

    trustedProviderPayment: providerPayment,
  });

  /*
    |--------------------------------------------------------------------------
    | Part 191 — Captured Payment Finalization
    |--------------------------------------------------------------------------
    */

  let orderFinalization = null;

  if (
    synchronization.paymentTransaction.status ===
    PAYMENT_TRANSACTION_STATUSES.PAID
  ) {
    orderFinalization = await finalizeCapturedCustomerOnlineOrder({
      orderId: synchronization.paymentTransaction.order,

      paymentTransactionId: synchronization.paymentTransaction._id,

      customerId: synchronization.paymentTransaction.customer,
    });
  }

  return {
    action: orderFinalization
      ? orderFinalization.action
      : synchronization.action,

    paymentTransaction: synchronization.paymentTransaction,

    providerPayment,

    orderFinalization,
  };
};

/*
|--------------------------------------------------------------------------
| Process Next Payment Webhook Event
|--------------------------------------------------------------------------
|
| Part 194 exposes a worker primitive.
|
| Part 195 will schedule/call it repeatedly.
|--------------------------------------------------------------------------
*/

export const processNextPaymentWebhookEvent = async () => {
  const now = new Date();

  const staleBefore = new Date(now.getTime() - PAYMENT_WEBHOOK_STALE_CLAIM_MS);

  /*
|--------------------------------------------------------------------------
| Recover Exhausted / Abandoned Events
|--------------------------------------------------------------------------
|
| This also repairs final-attempt events left in `processing` if Node
| crashed while processing them.
|--------------------------------------------------------------------------
*/

  await deadLetterExhaustedPaymentWebhookEvents({
    maxAttempts: PAYMENT_WEBHOOK_MAX_ATTEMPTS,

    staleBefore,

    now,
  });

  /*
    |--------------------------------------------------------------------------
    | Atomic Claim
    |--------------------------------------------------------------------------
    */

  const webhookEvent = await claimNextPaymentWebhookEvent({
    now,

    staleBefore,

    maxAttempts: PAYMENT_WEBHOOK_MAX_ATTEMPTS,
  });

  if (!webhookEvent) {
    return {
      action: "idle",

      webhookEvent: null,

      result: null,
    };
  }

  try {
    /*
      |--------------------------------------------------------------------------
      | Process
      |--------------------------------------------------------------------------
      */

    const result = await processClaimedPaymentWebhookEvent(webhookEvent);

    /*
      |--------------------------------------------------------------------------
      | Inbox Processed
      |--------------------------------------------------------------------------
      */

    const processedWebhookEvent = await markPaymentWebhookEventProcessed(
      webhookEvent._id,
    );

    return {
      action: "processed",

      webhookEvent: processedWebhookEvent,

      result,
    };
  } catch (error) {
    /*
  |--------------------------------------------------------------------------
  | Retry Limit
  |--------------------------------------------------------------------------
  |
  | processingAttempts was already incremented atomically when this event
  | was claimed.
  |--------------------------------------------------------------------------
  */

    const exhausted =
      webhookEvent.processingAttempts >= PAYMENT_WEBHOOK_MAX_ATTEMPTS;

    const errorMessage = error?.code
      ? `${error.code}: ${error.message}`
      : (error?.message ?? "Payment webhook processing failed");

    /*
  |--------------------------------------------------------------------------
  | Dead Letter
  |--------------------------------------------------------------------------
  */

    if (exhausted) {
      const deadLetteredWebhookEvent =
        await markPaymentWebhookEventDeadLettered(
          webhookEvent._id,

          {
            errorMessage,

            deadLetteredAt: new Date(),
          },
        );

      return {
        action: "dead-lettered",

        exhausted: true,

        webhookEvent: deadLetteredWebhookEvent,

        error: {
          code: error?.code ?? "PAYMENT_WEBHOOK_PROCESSING_FAILED",

          message: error?.message ?? "Payment webhook processing failed",
        },
      };
    }

    /*
  |--------------------------------------------------------------------------
  | Retryable Failure
  |--------------------------------------------------------------------------
  */

    const retryDelayMs = getWebhookRetryDelayMs(
      webhookEvent.processingAttempts,
    );

    const nextAttemptAt = new Date(Date.now() + retryDelayMs);

    const failedWebhookEvent = await markPaymentWebhookEventFailed(
      webhookEvent._id,

      {
        errorMessage,

        nextAttemptAt,
      },
    );

    return {
      action: "failed",

      exhausted: false,

      webhookEvent: failedWebhookEvent,

      error: {
        code: error?.code ?? "PAYMENT_WEBHOOK_PROCESSING_FAILED",

        message: error?.message ?? "Payment webhook processing failed",
      },
    };
  }
};

/*
|--------------------------------------------------------------------------
| Automatically Expired Order
|--------------------------------------------------------------------------
*/

const wasOrderAutomaticallyExpired = (order) => {
  if (!order) {
    return false;
  }

  if (
    order.status !== ORDER_STATUSES.CANCELLED ||
    order.inventoryStatus !== ORDER_INVENTORY_STATUSES.RELEASED
  ) {
    return false;
  }

  return (order.statusHistory ?? []).some((entry) => {
    return (
      entry.status === ORDER_STATUSES.CANCELLED &&
      entry.changedByType === AUDIT_ACTOR_TYPES.SYSTEM &&
      entry.systemActor === SYSTEM_AUDIT_ACTORS.ORDER_RESERVATION_EXPIRY
    );
  });
};
