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

/*
|--------------------------------------------------------------------------
| Build Admin Webhook Filter
|--------------------------------------------------------------------------
*/

const buildAdminPaymentWebhookFilter = (filters) => {
  const filter = {};

  if (filters.processingStatus) {
    filter.processingStatus = filters.processingStatus;
  }

  if (filters.eventType) {
    filter.eventType = filters.eventType;
  }

  if (filters.providerEventId) {
    filter.providerEventId = filters.providerEventId;
  }

  if (filters.providerPaymentId) {
    filter["payment.providerPaymentId"] = filters.providerPaymentId;
  }

  if (filters.providerOrderId) {
    filter["payment.providerOrderId"] = filters.providerOrderId;
  }

  /*
    |--------------------------------------------------------------------------
    | Received Date Range
    |--------------------------------------------------------------------------
    */

  if (filters.from || filters.to) {
    filter.receivedAt = {};

    if (filters.from) {
      filter.receivedAt.$gte = filters.from;
    }

    if (filters.to) {
      filter.receivedAt.$lte = filters.to;
    }
  }

  return filter;
};

/*
|--------------------------------------------------------------------------
| List Admin Payment Webhook Events
|--------------------------------------------------------------------------
*/

export const listAdminPaymentWebhookEvents = async (filters = {}) => {
  const {
    page = 1,

    limit = 20,

    sortDirection = "desc",
  } = filters;

  const skip = (page - 1) * limit;

  const direction = sortDirection === "asc" ? 1 : -1;

  const filter = buildAdminPaymentWebhookFilter(filters);

  const [events, totalItems] = await Promise.all([
    PaymentWebhookEvent.find(filter)
      .sort({
        receivedAt: direction,

        _id: direction,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    PaymentWebhookEvent.countDocuments(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    events,

    pagination: {
      page,

      limit,

      totalItems,

      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Find Admin Webhook Event
|--------------------------------------------------------------------------
*/

export const findAdminPaymentWebhookEventById = (webhookEventId) => {
  return PaymentWebhookEvent.findById(webhookEventId).lean();
};

/*
|--------------------------------------------------------------------------
| Requeue Dead-Lettered Webhook
|--------------------------------------------------------------------------
|
| Only:
|
| dead-lettered
|      ↓
| pending
|
| processingAttempts resets because this is a deliberate new recovery
| cycle after an administrator fixed the underlying problem.
|--------------------------------------------------------------------------
*/

export const requeueDeadLetteredPaymentWebhookEvent = (
  webhookEventId,

  {
    adminUserId,

    requeuedAt = new Date(),
  },
) => {
  return PaymentWebhookEvent.findOneAndUpdate(
    {
      _id: webhookEventId,

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,
    },

    {
      $set: {
        processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

        processingAttempts: 0,

        nextAttemptAt: requeuedAt,

        claimedAt: null,

        processedAt: null,

        deadLetteredAt: null,

        lastRequeuedAt: requeuedAt,

        lastRequeuedBy: adminUserId,
      },

      $inc: {
        requeueCount: 1,
      },
    },

    {
      returnDocument: "after",

      runValidators: true,
    },
  ).lean();
};

/*
|--------------------------------------------------------------------------
| Admin Payment Webhook Queue Summary
|--------------------------------------------------------------------------
|
| Operational overview only.
|
| No webhook state is modified here.
|--------------------------------------------------------------------------
*/

export const getAdminPaymentWebhookQueueSummary = async ({
  now = new Date(),
} = {}) => {
  /*
    |--------------------------------------------------------------------------
    | Status Counters
    |--------------------------------------------------------------------------
    */

  const [
    total,

    pending,

    processing,

    processed,

    failed,

    deadLettered,

    authorizedEvents,

    capturedEvents,

    failedEvents,

    dueNow,

    oldestUnresolved,

    latestProcessed,

    latestDeadLettered,
  ] = await Promise.all([
    /*
      |--------------------------------------------------------------------------
      | Total
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments(),

    /*
      |--------------------------------------------------------------------------
      | Pending
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,
    }),

    /*
      |--------------------------------------------------------------------------
      | Processing
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,
    }),

    /*
      |--------------------------------------------------------------------------
      | Processed
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSED,
    }),

    /*
      |--------------------------------------------------------------------------
      | Failed / Retryable
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,
    }),

    /*
      |--------------------------------------------------------------------------
      | Dead Letter
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,
    }),

    /*
      |--------------------------------------------------------------------------
      | Event Type — Authorized
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      eventType: "payment.authorized",
    }),

    /*
      |--------------------------------------------------------------------------
      | Event Type — Captured
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      eventType: "payment.captured",
    }),

    /*
      |--------------------------------------------------------------------------
      | Event Type — Failed
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      eventType: "payment.failed",
    }),

    /*
      |--------------------------------------------------------------------------
      | Events Due For Worker Processing
      |--------------------------------------------------------------------------
      |
      | Includes:
      |
      | pending + due now
      | failed + retry due now
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.countDocuments({
      processingStatus: {
        $in: [
          PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

          PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,
        ],
      },

      nextAttemptAt: {
        $lte: now,
      },
    }),

    /*
      |--------------------------------------------------------------------------
      | Oldest Unresolved Event
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.findOne({
      processingStatus: {
        $in: [
          PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

          PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,

          PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,

          PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,
        ],
      },
    })
      .sort({
        receivedAt: 1,
      })
      .select({
        receivedAt: 1,
      })
      .lean(),

    /*
      |--------------------------------------------------------------------------
      | Latest Successfully Processed Event
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.findOne({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSED,

      processedAt: {
        $ne: null,
      },
    })
      .sort({
        processedAt: -1,
      })
      .select({
        processedAt: 1,
      })
      .lean(),

    /*
      |--------------------------------------------------------------------------
      | Latest Dead-Letter Event
      |--------------------------------------------------------------------------
      */

    PaymentWebhookEvent.findOne({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

      deadLetteredAt: {
        $ne: null,
      },
    })
      .sort({
        deadLetteredAt: -1,
      })
      .select({
        deadLetteredAt: 1,
      })
      .lean(),
  ]);

  /*
    |--------------------------------------------------------------------------
    | Unresolved Queue
    |--------------------------------------------------------------------------
    */

  const unresolved = pending + processing + failed + deadLettered;

  return {
    total,

    byStatus: {
      pending,

      processing,

      processed,

      failed,

      deadLettered,
    },

    byEventType: {
      paymentAuthorized: authorizedEvents,

      paymentCaptured: capturedEvents,

      paymentFailed: failedEvents,
    },

    queue: {
      unresolved,

      dueNow,

      oldestUnresolvedReceivedAt: oldestUnresolved?.receivedAt ?? null,
    },

    activity: {
      latestProcessedAt: latestProcessed?.processedAt ?? null,

      latestDeadLetteredAt: latestDeadLettered?.deadLetteredAt ?? null,
    },

    /*
      |--------------------------------------------------------------------------
      | Operations Attention Flag
      |--------------------------------------------------------------------------
      |
      | We only flag dead-letter events here.
      |
      | A temporary `failed` retry is expected behavior and does not
      | automatically mean human intervention is required.
      |--------------------------------------------------------------------------
      */

    attentionRequired: deadLettered > 0,
  };
};
