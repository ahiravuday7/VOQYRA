import PaymentWebhookEvent from "./payment-webhook-event.model.js";

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
