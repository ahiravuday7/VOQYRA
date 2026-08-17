import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import PaymentWebhookEvent, {
  PAYMENT_WEBHOOK_EVENT_TYPES,
  PAYMENT_WEBHOOK_PROCESSING_STATUSES,
} from "../../src/modules/payments/payment-webhook-event.model.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

/*
|--------------------------------------------------------------------------
| Fixture
|--------------------------------------------------------------------------
*/

let webhookSequence = 0;

const createPaymentWebhookEventFixture = async ({
  processingStatus = PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

  eventType = PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_CAPTURED,

  providerEventId = null,

  providerPaymentId = null,

  providerOrderId = null,

  receivedAt = new Date(),

  processingAttempts = 0,
} = {}) => {
  webhookSequence += 1;

  const suffix = String(webhookSequence).padStart(3, "0");

  const resolvedProviderEventId = providerEventId ?? `evt_admin_${suffix}`;

  const resolvedPaymentId = providerPaymentId ?? `pay_admin_${suffix}`;

  const resolvedOrderId = providerOrderId ?? `order_admin_${suffix}`;

  const deadLettered =
    processingStatus === PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED;

  return PaymentWebhookEvent.create({
    provider: "razorpay",

    providerEventId: resolvedProviderEventId,

    eventType,

    payloadHash: "c".repeat(64),

    payment: {
      providerPaymentId: resolvedPaymentId,

      providerOrderId: resolvedOrderId,

      amountSubunits: 89900,

      currency: "INR",

      status:
        eventType === PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_FAILED
          ? "failed"
          : "captured",

      captured: eventType === PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_CAPTURED,

      method: "upi",
    },

    providerCreatedAt: receivedAt,

    receivedAt,

    processingStatus,

    processingAttempts,

    nextAttemptAt: deadLettered ? null : new Date(),

    deadLetteredAt: deadLettered ? new Date() : null,

    lastError: deadLettered
      ? "PAYMENT_WEBHOOK_PAYMENT_TRANSACTION_NOT_FOUND: transaction missing"
      : null,
  });
};

/*
|--------------------------------------------------------------------------
| Part 197
|--------------------------------------------------------------------------
*/

describe("Admin Payment webhook operations", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/admin/payment-webhooks");

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("rejects a customer from webhook administration", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await agent.get("/api/v1/admin/payment-webhooks");

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | List + Filtering
    |--------------------------------------------------------------------------
    */

  it("lists and filters webhook events for an admin", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    await createPaymentWebhookEventFixture({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

      providerEventId: "evt_pending",
    });

    await createPaymentWebhookEventFixture({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_CAPTURED,

      providerEventId: "evt_dead_letter",
    });

    await createPaymentWebhookEventFixture({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_FAILED,

      providerEventId: "evt_failed_dead_letter",
    });

    const response = await agent.get("/api/v1/admin/payment-webhooks").query({
      processingStatus: "dead-lettered",

      eventType: "payment.captured",

      page: 1,

      limit: 10,
    });

    expect(response.status).toBe(200);

    expect(response.body.data.paymentWebhookEvents).toHaveLength(1);

    expect(response.body.data.paymentWebhookEvents[0].providerEventId).toBe(
      "evt_dead_letter",
    );

    expect(response.body.data.pagination.totalItems).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Details
    |--------------------------------------------------------------------------
    */

  it("returns safe webhook details", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const webhook = await createPaymentWebhookEventFixture({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,
    });

    const response = await agent.get(
      `/api/v1/admin/payment-webhooks/${webhook._id}`,
    );

    expect(response.status).toBe(200);

    const event = response.body.data.paymentWebhookEvent;

    expect(event.id).toBe(String(webhook._id));

    expect(event.processing.status).toBe("dead-lettered");

    expect(event.payment.providerPaymentId).toBeTruthy();

    expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/);

    expect(event.rawBody).toBeUndefined();

    expect(event.signature).toBeUndefined();
  });

  /*
    |--------------------------------------------------------------------------
    | Requeue
    |--------------------------------------------------------------------------
    */

  it("allows an admin to requeue a dead-lettered webhook event", async () => {
    const {
      agent,

      user: admin,
    } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const webhook = await createPaymentWebhookEventFixture({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

      processingAttempts: 8,
    });

    const response = await agent.post(
      `/api/v1/admin/payment-webhooks/${webhook._id}/requeue`,
    );

    expect(response.status).toBe(200);

    expect(response.body.data.paymentWebhookEvent.processing.status).toBe(
      "pending",
    );

    expect(response.body.data.paymentWebhookEvent.processing.attempts).toBe(0);

    const stored = await PaymentWebhookEvent.findById(webhook._id).lean();

    expect(stored.processingStatus).toBe(
      PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,
    );

    expect(stored.processingAttempts).toBe(0);

    expect(stored.nextAttemptAt).toBeInstanceOf(Date);

    expect(stored.deadLetteredAt).toBeNull();

    expect(stored.requeueCount).toBe(1);

    expect(String(stored.lastRequeuedBy)).toBe(String(admin._id));

    expect(stored.lastRequeuedAt).toBeInstanceOf(Date);

    /*
     * Preserved until the worker claims
     * the requeued event.
     */
    expect(stored.lastError).toContain(
      "PAYMENT_WEBHOOK_PAYMENT_TRANSACTION_NOT_FOUND",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Requeue State
    |--------------------------------------------------------------------------
    */

  it("rejects manual requeue when the webhook is not dead-lettered", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const webhook = await createPaymentWebhookEventFixture({
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,
    });

    const response = await agent.post(
      `/api/v1/admin/payment-webhooks/${webhook._id}/requeue`,
    );

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "PAYMENT_WEBHOOK_REQUEUE_STATE_INVALID",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Unknown Webhook
    |--------------------------------------------------------------------------
    */

  it("returns 404 for an unknown webhook event", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const unknownId = "507f1f77bcf86cd799439011";

    const response = await agent.get(
      `/api/v1/admin/payment-webhooks/${unknownId}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("PAYMENT_WEBHOOK_EVENT_NOT_FOUND");
  });

  /*
|--------------------------------------------------------------------------
| Queue Summary — Empty
|--------------------------------------------------------------------------
*/

  it("returns an empty webhook queue summary", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const response = await agent.get("/api/v1/admin/payment-webhooks/summary");

    expect(response.status).toBe(200);

    const summary = response.body.data.summary;

    expect(summary.total).toBe(0);

    expect(summary.byStatus).toEqual({
      pending: 0,

      processing: 0,

      processed: 0,

      failed: 0,

      deadLettered: 0,
    });

    expect(summary.queue.unresolved).toBe(0);

    expect(summary.queue.dueNow).toBe(0);

    expect(summary.queue.oldestUnresolvedReceivedAt).toBeNull();

    expect(summary.activity.latestProcessedAt).toBeNull();

    expect(summary.activity.latestDeadLetteredAt).toBeNull();

    expect(summary.attentionRequired).toBe(false);
  });

  /*
|--------------------------------------------------------------------------
| Queue Summary — Mixed State
|--------------------------------------------------------------------------
*/

  it("summarizes webhook processing and event-type state for administrators", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const now = Date.now();

    /*
    |--------------------------------------------------------------------------
    | Pending + Due
    |--------------------------------------------------------------------------
    */

    await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_summary_pending",

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_AUTHORIZED,

      payloadHash: "a".repeat(64),

      payment: {
        providerPaymentId: "pay_summary_pending",

        providerOrderId: "order_summary_pending",

        amountSubunits: 89900,

        currency: "INR",

        status: "authorized",

        captured: false,

        method: "card",
      },

      receivedAt: new Date(now - 30_000),

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,

      nextAttemptAt: new Date(now - 1_000),
    });

    /*
    |--------------------------------------------------------------------------
    | Processing
    |--------------------------------------------------------------------------
    */

    await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_summary_processing",

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_CAPTURED,

      payloadHash: "b".repeat(64),

      payment: {
        providerPaymentId: "pay_summary_processing",

        providerOrderId: "order_summary_processing",

        amountSubunits: 89900,

        currency: "INR",

        status: "captured",

        captured: true,

        method: "upi",
      },

      receivedAt: new Date(now - 20_000),

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSING,

      claimedAt: new Date(),
    });

    /*
    |--------------------------------------------------------------------------
    | Processed
    |--------------------------------------------------------------------------
    */

    await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_summary_processed",

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_CAPTURED,

      payloadHash: "c".repeat(64),

      payment: {
        providerPaymentId: "pay_summary_processed",

        providerOrderId: "order_summary_processed",

        amountSubunits: 89900,

        currency: "INR",

        status: "captured",

        captured: true,

        method: "upi",
      },

      receivedAt: new Date(now - 10_000),

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PROCESSED,

      processedAt: new Date(now - 5_000),

      nextAttemptAt: new Date(),
    });

    /*
    |--------------------------------------------------------------------------
    | Retryable Failure + Due
    |--------------------------------------------------------------------------
    */

    await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_summary_failed",

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_FAILED,

      payloadHash: "d".repeat(64),

      payment: {
        providerPaymentId: "pay_summary_failed",

        providerOrderId: "order_summary_failed",

        amountSubunits: 89900,

        currency: "INR",

        status: "failed",

        captured: false,

        method: "upi",
      },

      receivedAt: new Date(now - 15_000),

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,

      processingAttempts: 2,

      nextAttemptAt: new Date(now - 1_000),

      lastError: "Temporary provider failure",
    });

    /*
    |--------------------------------------------------------------------------
    | Dead Letter
    |--------------------------------------------------------------------------
    */

    await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_summary_dead",

      eventType: PAYMENT_WEBHOOK_EVENT_TYPES.PAYMENT_CAPTURED,

      payloadHash: "e".repeat(64),

      payment: {
        providerPaymentId: "pay_summary_dead",

        providerOrderId: "order_summary_dead",

        amountSubunits: 89900,

        currency: "INR",

        status: "captured",

        captured: true,

        method: "upi",
      },

      receivedAt: new Date(now - 40_000),

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,

      processingAttempts: 8,

      nextAttemptAt: null,

      deadLetteredAt: new Date(now - 2_000),

      lastError: "Retry limit exhausted",
    });

    /*
    |--------------------------------------------------------------------------
    | Summary
    |--------------------------------------------------------------------------
    */

    const response = await agent.get("/api/v1/admin/payment-webhooks/summary");

    expect(response.status).toBe(200);

    const summary = response.body.data.summary;

    expect(summary.total).toBe(5);

    expect(summary.byStatus).toEqual({
      pending: 1,

      processing: 1,

      processed: 1,

      failed: 1,

      deadLettered: 1,
    });

    /*
    |--------------------------------------------------------------------------
    | Event Types
    |--------------------------------------------------------------------------
    */

    expect(summary.byEventType).toEqual({
      paymentAuthorized: 1,

      paymentCaptured: 3,

      paymentFailed: 1,
    });

    /*
    |--------------------------------------------------------------------------
    | Queue
    |--------------------------------------------------------------------------
    */

    expect(summary.queue.unresolved).toBe(4);

    /*
     * pending + failed are both due.
     */
    expect(summary.queue.dueNow).toBe(2);

    expect(summary.queue.oldestUnresolvedReceivedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Activity
    |--------------------------------------------------------------------------
    */

    expect(summary.activity.latestProcessedAt).toBeTruthy();

    expect(summary.activity.latestDeadLetteredAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Attention
    |--------------------------------------------------------------------------
    */

    expect(summary.attentionRequired).toBe(true);
  });

  /*
|--------------------------------------------------------------------------
| Queue Summary Authorization
|--------------------------------------------------------------------------
*/

  it("rejects customer access to the webhook queue summary", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await agent.get("/api/v1/admin/payment-webhooks/summary");

    expect(response.status).toBe(403);
  });
});
