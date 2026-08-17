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
