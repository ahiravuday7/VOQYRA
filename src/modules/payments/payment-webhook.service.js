import crypto from "node:crypto";

import env from "../../config/environment.js";

import AppError from "../../shared/errors/app-error.js";

import { PAYMENT_PROVIDERS } from "./payment.model.js";

import { PAYMENT_WEBHOOK_EVENT_TYPE_VALUES } from "./payment-webhook-event.model.js";

import { storePaymentWebhookEvent } from "./payment-webhook.repository.js";

/*
|--------------------------------------------------------------------------
| Razorpay Signature
|--------------------------------------------------------------------------
*/

const RAZORPAY_SIGNATURE_PATTERN = /^[a-fA-F0-9]{64}$/;

/*
|--------------------------------------------------------------------------
| Webhook Error
|--------------------------------------------------------------------------
*/

const createWebhookRequestInvalidError = (
  message,

  errorCode,
) => {
  return new AppError(
    message,

    400,

    {
      errorCode,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Verify Razorpay Webhook Signature
|--------------------------------------------------------------------------
|
| Razorpay:
|
| HMAC_SHA256(
|   raw request body,
|   webhook secret
| )
|--------------------------------------------------------------------------
*/

const verifyRazorpayWebhookSignature = ({
  rawBody,

  signature,
}) => {
  if (
    !Buffer.isBuffer(rawBody) ||
    !RAZORPAY_SIGNATURE_PATTERN.test(signature ?? "")
  ) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac(
      "sha256",

      env.RAZORPAY_WEBHOOK_SECRET,
    )
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(
    expectedSignature,

    "hex",
  );

  const receivedBuffer = Buffer.from(
    signature,

    "hex",
  );

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,

    receivedBuffer,
  );
};

/*
|--------------------------------------------------------------------------
| Parse Raw Webhook Body
|--------------------------------------------------------------------------
|
| Signature verification MUST happen first.
|--------------------------------------------------------------------------
*/

const parseWebhookBody = (rawBody) => {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw createWebhookRequestInvalidError(
      "Razorpay webhook body is not valid JSON",

      "RAZORPAY_WEBHOOK_BODY_INVALID",
    );
  }
};

/*
|--------------------------------------------------------------------------
| Normalize Razorpay Payment Snapshot
|--------------------------------------------------------------------------
|
| This snapshot is for audit/reconciliation.
|
| Part 194 will still fetch the Payment directly from Razorpay before
| applying important business-state changes.
|--------------------------------------------------------------------------
*/

const normalizePaymentSnapshot = (event) => {
  const payment = event?.payload?.payment?.entity;

  const valid =
    payment &&
    typeof payment.id === "string" &&
    payment.id.trim() &&
    typeof payment.order_id === "string" &&
    payment.order_id.trim() &&
    Number.isSafeInteger(payment.amount) &&
    payment.amount > 0 &&
    typeof payment.currency === "string" &&
    payment.currency.trim() &&
    typeof payment.status === "string" &&
    payment.status.trim() &&
    typeof payment.captured === "boolean";

  if (!valid) {
    throw createWebhookRequestInvalidError(
      "Razorpay webhook Payment payload is invalid",

      "RAZORPAY_WEBHOOK_PAYMENT_INVALID",
    );
  }

  return {
    providerPaymentId: payment.id.trim(),

    providerOrderId: payment.order_id.trim(),

    amountSubunits: payment.amount,

    currency: payment.currency.trim().toUpperCase(),

    status: payment.status.trim().toLowerCase(),

    captured: payment.captured,

    method:
      typeof payment.method === "string" && payment.method.trim()
        ? payment.method.trim().toLowerCase()
        : null,
  };
};

/*
|--------------------------------------------------------------------------
| Ingest Razorpay Webhook
|--------------------------------------------------------------------------
|
| Part 193:
|
| raw body
|    ↓
| signature verification
|    ↓
| event validation
|    ↓
| idempotent MongoDB inbox
|
| NO Order/Payment mutation here.
|--------------------------------------------------------------------------
*/

export const ingestRazorpayWebhook = async ({
  rawBody,

  signature,

  providerEventId,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Raw Body Required
    |--------------------------------------------------------------------------
    */

  if (!Buffer.isBuffer(rawBody)) {
    throw createWebhookRequestInvalidError(
      "Razorpay webhook raw body is required",

      "RAZORPAY_WEBHOOK_RAW_BODY_REQUIRED",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Event ID Required
    |--------------------------------------------------------------------------
    */

  if (
    typeof providerEventId !== "string" ||
    !providerEventId.trim() ||
    providerEventId.trim().length > 200
  ) {
    throw createWebhookRequestInvalidError(
      "Razorpay webhook event ID is required and must be valid",

      "RAZORPAY_WEBHOOK_EVENT_ID_REQUIRED",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Signature Required
    |--------------------------------------------------------------------------
    */

  if (typeof signature !== "string" || !signature.trim()) {
    throw createWebhookRequestInvalidError(
      "Razorpay webhook signature is required",

      "RAZORPAY_WEBHOOK_SIGNATURE_REQUIRED",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Verify Signature BEFORE Parsing JSON
    |--------------------------------------------------------------------------
    */

  if (
    !verifyRazorpayWebhookSignature({
      rawBody,

      signature,
    })
  ) {
    throw createWebhookRequestInvalidError(
      "Razorpay webhook signature is invalid",

      "RAZORPAY_WEBHOOK_SIGNATURE_INVALID",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Parse Signed Body
    |--------------------------------------------------------------------------
    */

  const event = parseWebhookBody(rawBody);

  const eventType = typeof event?.event === "string" ? event.event.trim() : "";

  /*
    |--------------------------------------------------------------------------
    | Unsupported Signed Events
    |--------------------------------------------------------------------------
    |
    | Acknowledge them with HTTP 200.
    |
    | Do not make Razorpay retry an event that our application intentionally
    | does not process.
    |--------------------------------------------------------------------------
    */

  if (!PAYMENT_WEBHOOK_EVENT_TYPE_VALUES.includes(eventType)) {
    return {
      action: "ignore",

      eventType: eventType || null,

      webhookEvent: null,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Payment Snapshot
    |--------------------------------------------------------------------------
    */

  const payment = normalizePaymentSnapshot(event);

  /*
    |--------------------------------------------------------------------------
    | Payload Hash
    |--------------------------------------------------------------------------
    */

  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

  /*
    |--------------------------------------------------------------------------
    | Provider Timestamp
    |--------------------------------------------------------------------------
    */

  const providerCreatedAt =
    Number.isSafeInteger(event.created_at) && event.created_at > 0
      ? new Date(event.created_at * 1000)
      : null;

  /*
    |--------------------------------------------------------------------------
    | Durable Inbox
    |--------------------------------------------------------------------------
    */

  const result = await storePaymentWebhookEvent({
    provider: PAYMENT_PROVIDERS.RAZORPAY,

    providerEventId: providerEventId.trim(),

    eventType,

    payloadHash,

    payment,

    providerCreatedAt,

    receivedAt: new Date(),

    nextAttemptAt: new Date(),
  });

  return {
    ...result,

    eventType,
  };
};
