import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import PaymentWebhookEvent from "../../src/modules/payments/payment-webhook-event.model.js";

import { createTestRazorpayWebhookSignature } from "../helpers/payment-provider-test.helper.js";

/*
|--------------------------------------------------------------------------
| Razorpay Webhook Test Event
|--------------------------------------------------------------------------
*/

const createRazorpayWebhookPayload = ({
  event = "payment.captured",

  providerPaymentId = "pay_test_webhook_193",

  providerOrderId = "order_test_webhook_193",

  status = "captured",

  captured = true,

  method = "upi",
} = {}) => {
  return {
    entity: "event",

    event,

    contains: ["payment"],

    payload: {
      payment: {
        entity: {
          id: providerPaymentId,

          entity: "payment",

          amount: 89900,

          currency: "INR",

          status,

          order_id: providerOrderId,

          method,

          captured,
        },
      },
    },

    created_at: Math.floor(Date.now() / 1000),
  };
};

/*
|--------------------------------------------------------------------------
| Send Signed Razorpay Webhook
|--------------------------------------------------------------------------
*/

const sendRazorpayWebhook = ({
  payload,

  eventId,

  signatureBody = null,
}) => {
  const rawBody = JSON.stringify(payload);

  const bodyUsedForSignature = signatureBody ?? rawBody;

  const signature = createTestRazorpayWebhookSignature(bodyUsedForSignature);

  return request(app)
    .post("/api/v1/webhooks/payments/razorpay")
    .set(
      "Content-Type",

      "application/json",
    )
    .set(
      "x-razorpay-event-id",

      eventId,
    )
    .set(
      "x-razorpay-signature",

      signature,
    )
    .send(rawBody);
};

/*
|--------------------------------------------------------------------------
| Part 193
|--------------------------------------------------------------------------
*/

describe("Razorpay Payment webhook ingestion", () => {
  /*
    |--------------------------------------------------------------------------
    | 1. Valid Captured Webhook
    |--------------------------------------------------------------------------
    */

  it("verifies and durably stores a valid Razorpay Payment webhook", async () => {
    const payload = createRazorpayWebhookPayload();

    const response = await sendRazorpayWebhook({
      payload,

      eventId: "evt_part193_captured_001",
    });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.data.action).toBe("store");

    expect(response.body.data.eventType).toBe("payment.captured");

    /*
        |--------------------------------------------------------------------------
        | Stored Inbox Event
        |--------------------------------------------------------------------------
        */

    const storedEvent = await PaymentWebhookEvent.findOne({
      providerEventId: "evt_part193_captured_001",
    }).lean();

    expect(storedEvent).toBeTruthy();

    expect(storedEvent.provider).toBe("razorpay");

    expect(storedEvent.eventType).toBe("payment.captured");

    expect(storedEvent.payment.providerPaymentId).toBe("pay_test_webhook_193");

    expect(storedEvent.payment.providerOrderId).toBe("order_test_webhook_193");

    expect(storedEvent.payment.amountSubunits).toBe(89900);

    expect(storedEvent.payment.currency).toBe("INR");

    expect(storedEvent.payment.status).toBe("captured");

    expect(storedEvent.payment.captured).toBe(true);

    expect(storedEvent.processingStatus).toBe("pending");

    expect(storedEvent.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  /*
    |--------------------------------------------------------------------------
    | 2. Duplicate Delivery
    |--------------------------------------------------------------------------
    */

  it("reuses the stored inbox event when Razorpay sends the same event again", async () => {
    const payload = createRazorpayWebhookPayload();

    const eventId = "evt_part193_duplicate_001";

    const firstResponse = await sendRazorpayWebhook({
      payload,

      eventId,
    });

    expect(firstResponse.status).toBe(200);

    expect(firstResponse.body.data.action).toBe("store");

    /*
        |--------------------------------------------------------------------------
        | Same Event Again
        |--------------------------------------------------------------------------
        */

    const secondResponse = await sendRazorpayWebhook({
      payload,

      eventId,
    });

    expect(secondResponse.status).toBe(200);

    expect(secondResponse.body.data.action).toBe("reuse");

    expect(
      await PaymentWebhookEvent.countDocuments({
        providerEventId: eventId,
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | 3. Invalid Signature
    |--------------------------------------------------------------------------
    */

  it("rejects a webhook with an invalid Razorpay signature", async () => {
    const payload = createRazorpayWebhookPayload();

    const rawBody = JSON.stringify(payload);

    const response = await request(app)
      .post("/api/v1/webhooks/payments/razorpay")
      .set(
        "Content-Type",

        "application/json",
      )
      .set(
        "x-razorpay-event-id",

        "evt_part193_invalid_signature",
      )
      .set(
        "x-razorpay-signature",

        "f".repeat(64),
      )
      .send(rawBody);

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("RAZORPAY_WEBHOOK_SIGNATURE_INVALID");

    expect(await PaymentWebhookEvent.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 4. Event ID Required
    |--------------------------------------------------------------------------
    */

  it("rejects a signed webhook without x-razorpay-event-id", async () => {
    const payload = createRazorpayWebhookPayload();

    const rawBody = JSON.stringify(payload);

    const signature = createTestRazorpayWebhookSignature(rawBody);

    const response = await request(app)
      .post("/api/v1/webhooks/payments/razorpay")
      .set(
        "Content-Type",

        "application/json",
      )
      .set(
        "x-razorpay-signature",

        signature,
      )
      .send(rawBody);

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("RAZORPAY_WEBHOOK_EVENT_ID_REQUIRED");

    expect(await PaymentWebhookEvent.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 5. Unsupported Signed Event
    |--------------------------------------------------------------------------
    */

  it("acknowledges and ignores a valid but unsupported Razorpay event", async () => {
    const payload = {
      entity: "event",

      event: "order.paid",

      created_at: Math.floor(Date.now() / 1000),
    };

    const response = await sendRazorpayWebhook({
      payload,

      eventId: "evt_part193_ignored_001",
    });

    expect(response.status).toBe(200);

    expect(response.body.data.action).toBe("ignore");

    expect(response.body.data.accepted).toBe(false);

    expect(await PaymentWebhookEvent.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 6. Exact Raw Body Protection
    |--------------------------------------------------------------------------
    */

  it("rejects the webhook when the signed raw body differs from the received body", async () => {
    const payload = createRazorpayWebhookPayload();

    /*
     * Signature created from compact JSON.
     */
    const compactBody = JSON.stringify(payload);

    /*
     * Request uses differently formatted JSON.
     *
     * Semantically the same JSON,
     * but different bytes.
     */
    const prettyBody = JSON.stringify(
      payload,

      null,

      2,
    );

    const signature = createTestRazorpayWebhookSignature(compactBody);

    const response = await request(app)
      .post("/api/v1/webhooks/payments/razorpay")
      .set(
        "Content-Type",

        "application/json",
      )
      .set(
        "x-razorpay-event-id",

        "evt_part193_raw_body_001",
      )
      .set(
        "x-razorpay-signature",

        signature,
      )
      .send(prettyBody);

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("RAZORPAY_WEBHOOK_SIGNATURE_INVALID");
  });
});
