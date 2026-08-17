import AppError from "../../shared/errors/app-error.js";

import {
  findAdminPaymentWebhookEventById,
  listAdminPaymentWebhookEvents,
  requeueDeadLetteredPaymentWebhookEvent,
} from "./payment-webhook.repository.js";

import {
  toAdminPaymentWebhookEvent,
  toAdminPaymentWebhookEventList,
} from "./payment-webhook.admin.mapper.js";

/*
|--------------------------------------------------------------------------
| Errors
|--------------------------------------------------------------------------
*/

const createPaymentWebhookEventNotFoundError = () => {
  return new AppError(
    "Payment webhook event was not found",

    404,

    {
      errorCode: "PAYMENT_WEBHOOK_EVENT_NOT_FOUND",
    },
  );
};

const createPaymentWebhookRequeueStateInvalidError = (status) => {
  return new AppError(
    "Only a dead-lettered Payment webhook event can be manually requeued",

    409,

    {
      errorCode: "PAYMENT_WEBHOOK_REQUEUE_STATE_INVALID",

      details: {
        processingStatus: status ?? null,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Admin List
|--------------------------------------------------------------------------
*/

export const getAdminPaymentWebhookEvents = async (filters = {}) => {
  const result = await listAdminPaymentWebhookEvents(filters);

  return toAdminPaymentWebhookEventList(result);
};

/*
|--------------------------------------------------------------------------
| Admin Details
|--------------------------------------------------------------------------
*/

export const getAdminPaymentWebhookEvent = async (webhookEventId) => {
  const webhookEvent = await findAdminPaymentWebhookEventById(webhookEventId);

  if (!webhookEvent) {
    throw createPaymentWebhookEventNotFoundError();
  }

  return toAdminPaymentWebhookEvent(webhookEvent);
};

/*
|--------------------------------------------------------------------------
| Admin Manual Requeue
|--------------------------------------------------------------------------
*/

export const requeueAdminPaymentWebhookEvent = async ({
  webhookEventId,

  adminUserId,
}) => {
  const requeuedAt = new Date();

  /*
    |--------------------------------------------------------------------------
    | Atomic State Transition
    |--------------------------------------------------------------------------
    */

  const requeued = await requeueDeadLetteredPaymentWebhookEvent(
    webhookEventId,

    {
      adminUserId,

      requeuedAt,
    },
  );

  if (requeued) {
    return toAdminPaymentWebhookEvent(requeued);
  }

  /*
    |--------------------------------------------------------------------------
    | Determine Failure Reason
    |--------------------------------------------------------------------------
    */

  const existing = await findAdminPaymentWebhookEventById(webhookEventId);

  if (!existing) {
    throw createPaymentWebhookEventNotFoundError();
  }

  throw createPaymentWebhookRequeueStateInvalidError(existing.processingStatus);
};
