import {
  PAYMENT_PROVIDERS,
  PAYMENT_TRANSACTION_STATUSES,
} from "./payment.model.js";

import {
  findPaymentTransactionByProviderOrderReference,
  recordProviderVerifiedPaymentReference,
  markTrustedPaymentTransactionFailed,
} from "./payment.repository.js";

import { fetchAndVerifyPaymentProviderDetails } from "./providers/payment-provider.service.js";

import {
  synchronizeCustomerPaymentProviderState,
  finalizeCapturedCustomerOnlineOrder,
} from "./payment.service.js";

import {
  claimNextPaymentWebhookEvent,
  markPaymentWebhookEventProcessed,
  markPaymentWebhookEventFailed,
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
      | Retry Backoff
      |--------------------------------------------------------------------------
      */

    const retryDelayMs = getWebhookRetryDelayMs(
      webhookEvent.processingAttempts,
    );

    const nextAttemptAt = new Date(Date.now() + retryDelayMs);

    const failedWebhookEvent = await markPaymentWebhookEventFailed(
      webhookEvent._id,

      {
        errorMessage: error?.code
          ? `${error.code}: ${error.message}`
          : error?.message,

        nextAttemptAt,
      },
    );

    return {
      action: "failed",

      exhausted:
        webhookEvent.processingAttempts >= PAYMENT_WEBHOOK_MAX_ATTEMPTS,

      webhookEvent: failedWebhookEvent,

      error: {
        code: error?.code ?? "PAYMENT_WEBHOOK_PROCESSING_FAILED",

        message: error?.message ?? "Payment webhook processing failed",
      },
    };
  }
};
