import { ingestRazorpayWebhook } from "./payment-webhook.service.js";

/*
|--------------------------------------------------------------------------
| Receive Razorpay Payment Webhook
|--------------------------------------------------------------------------
*/

export const receiveRazorpayPaymentWebhookController = async (
  request,

  response,
) => {
  const result = await ingestRazorpayWebhook({
    /*
     * express.raw()
     *
     * request.body is a Buffer here.
     */
    rawBody: request.body,

    signature: request.get("x-razorpay-signature"),

    providerEventId: request.get("x-razorpay-event-id"),
  });

  request.log?.info(
    {
      provider: "razorpay",

      providerEventId: request.get("x-razorpay-event-id") ?? null,

      eventType: result.eventType,

      action: result.action,
    },

    "Razorpay Payment webhook ingested",
  );

  /*
    |--------------------------------------------------------------------------
    | Fast Acknowledgement
    |--------------------------------------------------------------------------
    */

  return response.status(200).json({
    success: true,

    message:
      result.action === "ignore"
        ? "Webhook event acknowledged and ignored"
        : result.action === "store"
          ? "Webhook event accepted"
          : "Webhook event already accepted",

    data: {
      action: result.action,

      eventType: result.eventType,

      accepted: result.action !== "ignore",
    },
  });
};
