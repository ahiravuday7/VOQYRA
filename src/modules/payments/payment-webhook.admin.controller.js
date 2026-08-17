import {
  getAdminPaymentWebhookEvent,
  getAdminPaymentWebhookEvents,
  requeueAdminPaymentWebhookEvent,
  getAdminPaymentWebhookQueueSummary,
} from "./payment-webhook.admin.service.js";

/*
|--------------------------------------------------------------------------
| List Payment Webhook Events
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/payment-webhooks
|--------------------------------------------------------------------------
*/

export const getAdminPaymentWebhookEventsController = async (
  request,

  response,
) => {
  const filters = request.validated.query;

  const result = await getAdminPaymentWebhookEvents(filters);

  request.log?.info(
    {
      adminId: String(request.user._id),

      resultCount: result.events.length,

      totalItems: result.pagination.totalItems,

      filters: {
        processingStatus: filters.processingStatus ?? null,

        eventType: filters.eventType ?? null,

        providerEventId: filters.providerEventId ?? null,

        providerPaymentId: filters.providerPaymentId ?? null,

        providerOrderId: filters.providerOrderId ?? null,
      },
    },

    "Admin Payment webhook events retrieved",
  );

  return response.status(200).json({
    success: true,

    message: "Payment webhook events retrieved successfully",

    data: {
      paymentWebhookEvents: result.events,

      pagination: result.pagination,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Payment Webhook Details
|--------------------------------------------------------------------------
*/

export const getAdminPaymentWebhookEventController = async (
  request,

  response,
) => {
  const { webhookEventId } = request.validated.params;

  const webhookEvent = await getAdminPaymentWebhookEvent(webhookEventId);

  return response.status(200).json({
    success: true,

    message: "Payment webhook event retrieved successfully",

    data: {
      paymentWebhookEvent: webhookEvent,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Requeue Dead-Letter Event
|--------------------------------------------------------------------------
*/

export const requeueAdminPaymentWebhookEventController = async (
  request,

  response,
) => {
  const { webhookEventId } = request.validated.params;

  const webhookEvent = await requeueAdminPaymentWebhookEvent({
    webhookEventId,

    adminUserId: request.user._id,
  });

  request.log?.warn(
    {
      adminId: String(request.user._id),

      webhookEventId,

      requeueCount: webhookEvent.requeue.count,
    },

    "Dead-lettered Payment webhook manually requeued",
  );

  return response.status(200).json({
    success: true,

    message: "Payment webhook event requeued successfully",

    data: {
      paymentWebhookEvent: webhookEvent,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Payment Webhook Queue Summary
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/payment-webhooks/summary
|--------------------------------------------------------------------------
*/

export const getAdminPaymentWebhookQueueSummaryController = async (
  request,

  response,
) => {
  const summary = await getAdminPaymentWebhookQueueSummary();

  request.log?.info(
    {
      adminId: String(request.user._id),

      unresolved: summary.queue.unresolved,

      dueNow: summary.queue.dueNow,

      deadLettered: summary.byStatus.deadLettered,

      attentionRequired: summary.attentionRequired,
    },

    "Admin Payment webhook queue summary retrieved",
  );

  return response.status(200).json({
    success: true,

    message: "Payment webhook queue summary retrieved successfully",

    data: {
      summary,
    },
  });
};
