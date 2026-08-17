import mongoose from "mongoose";

import { PAYMENT_PROVIDERS } from "./payment.model.js";

/*
|--------------------------------------------------------------------------
| Supported Razorpay Payment Webhook Events
|--------------------------------------------------------------------------
*/

export const PAYMENT_WEBHOOK_EVENT_TYPES = Object.freeze({
  PAYMENT_AUTHORIZED: "payment.authorized",

  PAYMENT_CAPTURED: "payment.captured",

  PAYMENT_FAILED: "payment.failed",
});

export const PAYMENT_WEBHOOK_EVENT_TYPE_VALUES = Object.freeze(
  Object.values(PAYMENT_WEBHOOK_EVENT_TYPES),
);

/*
|--------------------------------------------------------------------------
| Webhook Processing Status
|--------------------------------------------------------------------------
|
| Part 193 only stores events as pending.
|
| Part 194 will process them.
|--------------------------------------------------------------------------
*/

export const PAYMENT_WEBHOOK_PROCESSING_STATUSES = Object.freeze({
  PENDING: "pending",

  PROCESSING: "processing",

  PROCESSED: "processed",

  FAILED: "failed",

  /*
    |--------------------------------------------------------------------------
    | Dead Letter
    |--------------------------------------------------------------------------
    |
    | Automatic processing has exhausted all retry attempts.
    |
    | Part 197 can later expose controlled admin recovery.
    |--------------------------------------------------------------------------
    */

  DEAD_LETTERED: "dead-lettered",
});

export const PAYMENT_WEBHOOK_PROCESSING_STATUS_VALUES = Object.freeze(
  Object.values(PAYMENT_WEBHOOK_PROCESSING_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Provider Payment Snapshot
|--------------------------------------------------------------------------
|
| We intentionally do NOT store the entire webhook body.
|
| Only fields useful for reconciliation/audit are stored.
|--------------------------------------------------------------------------
*/

const paymentSnapshotSchema = new mongoose.Schema(
  {
    providerPaymentId: {
      type: String,

      required: true,

      trim: true,

      immutable: true,
    },

    providerOrderId: {
      type: String,

      required: true,

      trim: true,

      immutable: true,
    },

    /*
     * Razorpay returns the amount
     * in the smallest currency subunit.
     *
     * Example:
     *
     * ₹899
     * =>
     * 89900 paise
     */
    amountSubunits: {
      type: Number,

      required: true,

      min: 1,

      immutable: true,

      validate: {
        validator: Number.isSafeInteger,

        message: "Webhook Payment amount must be a safe integer",
      },
    },

    currency: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      maxlength: 10,

      immutable: true,
    },

    status: {
      type: String,

      required: true,

      trim: true,

      maxlength: 100,

      immutable: true,
    },

    captured: {
      type: Boolean,

      required: true,

      immutable: true,
    },

    method: {
      type: String,

      default: null,

      trim: true,

      maxlength: 100,

      immutable: true,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Payment Webhook Event
|--------------------------------------------------------------------------
*/

const paymentWebhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,

      required: true,

      enum: [PAYMENT_PROVIDERS.RAZORPAY],

      immutable: true,
    },

    /*
     * Razorpay sends:
     *
     * x-razorpay-event-id
     *
     * This is our idempotency key.
     */
    providerEventId: {
      type: String,

      required: true,

      trim: true,

      maxlength: 200,

      immutable: true,
    },

    eventType: {
      type: String,

      required: true,

      enum: PAYMENT_WEBHOOK_EVENT_TYPE_VALUES,

      immutable: true,
    },

    /*
     * SHA-256 of the exact raw body.
     *
     * Useful for audit/debugging without
     * retaining the complete provider payload.
     */
    payloadHash: {
      type: String,

      required: true,

      match: /^[a-f0-9]{64}$/,

      immutable: true,
    },

    payment: {
      type: paymentSnapshotSchema,

      required: true,

      immutable: true,
    },

    /*
     * Razorpay event.created_at
     */
    providerCreatedAt: {
      type: Date,

      default: null,

      immutable: true,
    },

    receivedAt: {
      type: Date,

      required: true,

      default: Date.now,

      immutable: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Processing Queue State
      |--------------------------------------------------------------------------
      */

    processingStatus: {
      type: String,

      required: true,

      enum: PAYMENT_WEBHOOK_PROCESSING_STATUS_VALUES,

      default: PAYMENT_WEBHOOK_PROCESSING_STATUSES.PENDING,
    },

    processingAttempts: {
      type: Number,

      required: true,

      min: 0,

      default: 0,
    },

    nextAttemptAt: {
      type: Date,

      default: Date.now,
    },

    claimedAt: {
      type: Date,

      default: null,
    },

    processedAt: {
      type: Date,

      default: null,
    },

    /*
|--------------------------------------------------------------------------
| Dead Letter Timestamp
|--------------------------------------------------------------------------
*/

    deadLetteredAt: {
      type: Date,

      default: null,
    },

    lastError: {
      type: String,

      trim: true,

      maxlength: 2000,

      default: null,
    },

    /*
|--------------------------------------------------------------------------
| Manual Requeue Audit
|--------------------------------------------------------------------------
*/

    requeueCount: {
      type: Number,

      required: true,

      min: 0,

      default: 0,
    },

    lastRequeuedAt: {
      type: Date,

      default: null,
    },

    lastRequeuedBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },
  },

  {
    timestamps: true,

    versionKey: false,
  },
);

/*
|--------------------------------------------------------------------------
| Idempotency
|--------------------------------------------------------------------------
*/

paymentWebhookEventSchema.index(
  {
    provider: 1,

    providerEventId: 1,
  },

  {
    unique: true,

    name: "uniq_payment_webhook_provider_event",
  },
);

/*
|--------------------------------------------------------------------------
| Future Part 194 Processing Queue
|--------------------------------------------------------------------------
*/

paymentWebhookEventSchema.index(
  {
    processingStatus: 1,

    nextAttemptAt: 1,

    receivedAt: 1,
  },

  {
    name: "payment_webhook_processing_queue",
  },
);

/*
|--------------------------------------------------------------------------
| Dead-Letter Operations
|--------------------------------------------------------------------------
*/

paymentWebhookEventSchema.index(
  {
    processingStatus: 1,

    deadLetteredAt: -1,
  },

  {
    name: "payment_webhook_dead_letter_queue",
  },
);

/*
|--------------------------------------------------------------------------
| Admin Processing Status Listing
|--------------------------------------------------------------------------
*/

paymentWebhookEventSchema.index(
  {
    processingStatus: 1,

    receivedAt: -1,
  },

  {
    name: "payment_webhook_admin_status_received",
  },
);

/*
|--------------------------------------------------------------------------
| Admin Provider Order Lookup
|--------------------------------------------------------------------------
*/

paymentWebhookEventSchema.index(
  {
    "payment.providerOrderId": 1,
  },

  {
    name: "payment_webhook_provider_order",
  },
);

/*
|--------------------------------------------------------------------------
| Payment Reconciliation Lookup
|--------------------------------------------------------------------------
*/

paymentWebhookEventSchema.index(
  {
    "payment.providerPaymentId": 1,
  },

  {
    name: "payment_webhook_provider_payment",
  },
);

const PaymentWebhookEvent = mongoose.model(
  "PaymentWebhookEvent",

  paymentWebhookEventSchema,
);

export default PaymentWebhookEvent;
