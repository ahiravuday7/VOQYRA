import PaymentWebhookEvent, {
  PAYMENT_WEBHOOK_PROCESSING_STATUSES,
} from "./payment-webhook-event.model.js";

/*
|--------------------------------------------------------------------------
| Store Payment Webhook Event
|--------------------------------------------------------------------------
|
| create
|    ↓
| unique provider + event ID
|
| duplicate
|    ↓
| return existing event
|--------------------------------------------------------------------------
*/

export const storePaymentWebhookEvent = async (webhookEvent) => {
  try {
    const created = await PaymentWebhookEvent.create(webhookEvent);

    return {
      action: "store",

      webhookEvent: created.toObject(),
    };
  } catch (error) {
    /*
      |--------------------------------------------------------------------------
      | Only Duplicate Key Means Idempotent Retry
      |--------------------------------------------------------------------------
      */

    if (error?.code !== 11000) {
      throw error;
    }

    const existing = await PaymentWebhookEvent.findOne({
      provider: webhookEvent.provider,

      providerEventId: webhookEvent.providerEventId,
    }).lean();

    if (!existing) {
      throw error;
    }

    return {
      action: "reuse",

      webhookEvent: existing,
    };
  }
};

/*
|--------------------------------------------------------------------------
| Claim Next Webhook Event
|--------------------------------------------------------------------------
|
| Atomic queue claim.
|
| Supports:
|
| pending
| failed + retry due
| stale processing claim after worker crash
|--------------------------------------------------------------------------
*/

export const claimNextPaymentWebhookEvent = ({
  now = new Date(),

  staleBefore,

  maxAttempts = 8,
}) => {
  return PaymentWebhookEvent.findOneAndUpdate(
    {
      processingAttempts: {
        $lt: maxAttempts,
      },

      $or: [
        {
          processingStatus: {
            $in: [
              PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

              PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,
            ],
          },

          nextAttemptAt: {
            $lte: now,
          },
        },

        {
          processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,

          claimedAt: {
            $lte: staleBefore,
          },
        },
      ],
    },

    {
      $set: {
        processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,

        claimedAt: now,

        lastError: null,
      },

      $inc: {
        processingAttempts: 1,
      },
    },

    {
      new: true,

      sort: {
        nextAttemptAt: 1,

        receivedAt: 1,
      },
    },
  ).lean();
};

/*
|--------------------------------------------------------------------------
| Mark Webhook Processed
|--------------------------------------------------------------------------
*/

export const markPaymentWebhookEventProcessed = (
  webhookEventId,

  { processedAt = new Date() } = {},
) => {
  return PaymentWebhookEvent.findOneAndUpdate(
    {
      _id: webhookEventId,

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,
    },

    {
      $set: {
        processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSED,

        processedAt,

        claimedAt: null,

        lastError: null,
      },
    },

    {
      new: true,
    },
  ).lean();
};

/*
|--------------------------------------------------------------------------
| Mark Webhook Processing Failed
|--------------------------------------------------------------------------
*/

export const markPaymentWebhookEventFailed = (
  webhookEventId,

  {
    errorMessage,

    nextAttemptAt,
  },
) => {
  return PaymentWebhookEvent.findOneAndUpdate(
    {
      _id: webhookEventId,

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,
    },

    {
      $set: {
        processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,

        claimedAt: null,

        lastError: String(
          errorMessage ?? "Unknown webhook processing error",
        ).slice(0, 2000),

        nextAttemptAt,
      },
    },

    {
      new: true,
    },
  ).lean();
};
