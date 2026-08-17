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

/*
|--------------------------------------------------------------------------
| Mark Webhook Event Dead-Lettered
|--------------------------------------------------------------------------
|
| The event exhausted automatic processing attempts.
|
| Important:
|
| nextAttemptAt = null
|
| Therefore the normal worker queue can never claim it again.
|--------------------------------------------------------------------------
*/

export const markPaymentWebhookEventDeadLettered = (
  webhookEventId,

  {
    errorMessage,

    deadLetteredAt = new Date(),
  },
) => {
  return PaymentWebhookEvent.findOneAndUpdate(
    {
      _id: webhookEventId,

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,
    },

    {
      $set: {
        processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

        claimedAt: null,

        nextAttemptAt: null,

        deadLetteredAt,

        lastError: String(
          errorMessage ?? "Webhook processing retry limit exhausted",
        ).slice(0, 2000),
      },
    },

    {
      returnDocument: "after",
    },
  ).lean();
};

/*
|--------------------------------------------------------------------------
| Dead-Letter Exhausted / Abandoned Webhook Events
|--------------------------------------------------------------------------
|
| Handles two recovery cases:
|
| 1. Old failed events that already exhausted attempts.
|
| 2. A worker claimed its final attempt and then crashed before it could
|    mark the event processed/failed/dead-lettered.
|--------------------------------------------------------------------------
*/

export const deadLetterExhaustedPaymentWebhookEvents = ({
  maxAttempts,

  staleBefore,

  now = new Date(),
}) => {
  return PaymentWebhookEvent.updateMany(
    {
      processingAttempts: {
        $gte: maxAttempts,
      },

      $or: [
        /*
          |--------------------------------------------------------------------------
          | Exhausted Failed Event
          |--------------------------------------------------------------------------
          */

        {
          processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,
        },

        /*
          |--------------------------------------------------------------------------
          | Abandoned Final Processing Attempt
          |--------------------------------------------------------------------------
          */

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
        processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

        claimedAt: null,

        nextAttemptAt: null,

        deadLetteredAt: now,
      },
    },
  );
};
