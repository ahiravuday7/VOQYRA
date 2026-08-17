/*
|--------------------------------------------------------------------------
| Normalize
|--------------------------------------------------------------------------
*/

const normalizeObject = (value) => {
  if (value && typeof value.toObject === "function") {
    return value.toObject();
  }

  return value;
};

/*
|--------------------------------------------------------------------------
| Identifier
|--------------------------------------------------------------------------
*/

const normalizeIdentifier = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Admin Webhook Event
|--------------------------------------------------------------------------
*/

export const toAdminPaymentWebhookEvent = (webhookEvent) => {
  const event = normalizeObject(webhookEvent);

  return {
    id: normalizeIdentifier(event._id),

    provider: event.provider,

    providerEventId: event.providerEventId,

    eventType: event.eventType,

    payloadHash: event.payloadHash,

    payment: {
      providerPaymentId: event.payment?.providerPaymentId ?? null,

      providerOrderId: event.payment?.providerOrderId ?? null,

      amountSubunits: event.payment?.amountSubunits ?? null,

      currency: event.payment?.currency ?? null,

      status: event.payment?.status ?? null,

      captured: event.payment?.captured ?? null,

      method: event.payment?.method ?? null,
    },

    processing: {
      status: event.processingStatus,

      attempts: event.processingAttempts,

      nextAttemptAt: event.nextAttemptAt ?? null,

      claimedAt: event.claimedAt ?? null,

      processedAt: event.processedAt ?? null,

      deadLetteredAt: event.deadLetteredAt ?? null,

      lastError: event.lastError ?? null,
    },

    requeue: {
      count: event.requeueCount ?? 0,

      lastRequeuedAt: event.lastRequeuedAt ?? null,

      lastRequeuedBy: normalizeIdentifier(event.lastRequeuedBy),
    },

    providerCreatedAt: event.providerCreatedAt ?? null,

    receivedAt: event.receivedAt,

    createdAt: event.createdAt,

    updatedAt: event.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Webhook List
|--------------------------------------------------------------------------
*/

export const toAdminPaymentWebhookEventList = ({
  events,

  pagination,
}) => {
  return {
    events: events.map((webhookEvent) => {
      return toAdminPaymentWebhookEvent(webhookEvent);
    }),

    pagination: {
      page: pagination.page,

      limit: pagination.limit,

      totalItems: pagination.totalItems,

      totalPages: pagination.totalPages,

      hasPreviousPage: pagination.hasPreviousPage,

      hasNextPage: pagination.hasNextPage,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Admin Payment Webhook Queue Summary
|--------------------------------------------------------------------------
*/

export const toAdminPaymentWebhookQueueSummary = (summary) => {
  return {
    total: summary.total,

    byStatus: {
      pending: summary.byStatus.pending,

      processing: summary.byStatus.processing,

      processed: summary.byStatus.processed,

      failed: summary.byStatus.failed,

      deadLettered: summary.byStatus.deadLettered,
    },

    byEventType: {
      paymentAuthorized: summary.byEventType.paymentAuthorized,

      paymentCaptured: summary.byEventType.paymentCaptured,

      paymentFailed: summary.byEventType.paymentFailed,
    },

    queue: {
      unresolved: summary.queue.unresolved,

      dueNow: summary.queue.dueNow,

      oldestUnresolvedReceivedAt: summary.queue.oldestUnresolvedReceivedAt,
    },

    activity: {
      latestProcessedAt: summary.activity.latestProcessedAt,

      latestDeadLetteredAt: summary.activity.latestDeadLetteredAt,
    },

    attentionRequired: summary.attentionRequired,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Payment Webhook Worker Health
|--------------------------------------------------------------------------
*/

export const toAdminPaymentWebhookWorkerHealth = (health) => {
  return {
    status: health.status,

    started: health.started,

    stopping: health.stopping,

    busy: health.busy,

    configuration: {
      intervalMs: health.configuration.intervalMs,

      batchSize: health.configuration.batchSize,
    },

    lifecycle: {
      startedAt: health.lifecycle.startedAt,

      stoppedAt: health.lifecycle.stoppedAt,
    },

    cycles: {
      total: health.cycles.total,

      successful: health.cycles.successful,

      failed: health.cycles.failed,

      skippedBusy: health.cycles.skippedBusy,
    },

    lastCycle: {
      startedAt: health.lastCycle.startedAt,

      finishedAt: health.lastCycle.finishedAt,

      durationMs: health.lastCycle.durationMs,

      result: health.lastCycle.result
        ? {
            ...health.lastCycle.result,
          }
        : null,

      error: health.lastCycle.error
        ? {
            ...health.lastCycle.error,
          }
        : null,
    },
  };
};
