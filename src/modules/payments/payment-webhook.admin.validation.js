import { z } from "zod";

import {
  PAYMENT_WEBHOOK_EVENT_TYPE_VALUES,
  PAYMENT_WEBHOOK_PROCESSING_STATUS_VALUES,
} from "./payment-webhook-event.model.js";

/*
|--------------------------------------------------------------------------
| Constants
|--------------------------------------------------------------------------
*/

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/*
|--------------------------------------------------------------------------
| Empty Object
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess(
  (value) => value ?? {},

  z.strictObject({}),
);

/*
|--------------------------------------------------------------------------
| ObjectId
|--------------------------------------------------------------------------
*/

const webhookEventIdSchema = z
  .string({
    error: "Webhook event ID must be a string",
  })
  .trim()
  .regex(OBJECT_ID_PATTERN, {
    error: "Webhook event ID must be a valid ObjectId",
  });

/*
|--------------------------------------------------------------------------
| Provider Reference
|--------------------------------------------------------------------------
*/

const providerReferenceSchema = z
  .string({
    error: "Provider reference must be a string",
  })
  .trim()
  .min(1, {
    error: "Provider reference cannot be empty",
  })
  .max(300, {
    error: "Provider reference cannot exceed 300 characters",
  });

/*
|--------------------------------------------------------------------------
| Admin Webhook List Query
|--------------------------------------------------------------------------
*/

const adminPaymentWebhookListQuerySchema = z
  .strictObject({
    page: z.coerce
      .number({
        error: "Page must be a number",
      })
      .int({
        error: "Page must be a whole number",
      })
      .min(1, {
        error: "Page must be at least 1",
      })
      .default(1),

    limit: z.coerce
      .number({
        error: "Limit must be a number",
      })
      .int({
        error: "Limit must be a whole number",
      })
      .min(1, {
        error: "Limit must be at least 1",
      })
      .max(100, {
        error: "Limit cannot exceed 100",
      })
      .default(20),

    processingStatus: z
      .enum(PAYMENT_WEBHOOK_PROCESSING_STATUS_VALUES, {
        error: "Webhook processing status is invalid",
      })
      .optional(),

    eventType: z
      .enum(PAYMENT_WEBHOOK_EVENT_TYPE_VALUES, {
        error: "Webhook event type is invalid",
      })
      .optional(),

    providerEventId: providerReferenceSchema.optional(),

    providerPaymentId: providerReferenceSchema.optional(),

    providerOrderId: providerReferenceSchema.optional(),

    from: z.coerce
      .date({
        error: "Webhook from date is invalid",
      })
      .optional(),

    to: z.coerce
      .date({
        error: "Webhook to date is invalid",
      })
      .optional(),

    sortDirection: z
      .enum(["asc", "desc"], {
        error: "Sort direction must be asc or desc",
      })
      .default("desc"),
  })
  .refine(
    (query) => {
      if (!query.from || !query.to) {
        return true;
      }

      return query.from.getTime() <= query.to.getTime();
    },
    {
      error: "Webhook from date cannot be later than the to date",

      path: ["to"],
    },
  );

/*
|--------------------------------------------------------------------------
| Admin Webhook List
|--------------------------------------------------------------------------
*/

export const adminPaymentWebhookListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: adminPaymentWebhookListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Admin Webhook Details
|--------------------------------------------------------------------------
*/

export const adminPaymentWebhookDetailsRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: z.strictObject({
    webhookEventId: webhookEventIdSchema,
  }),

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Webhook Requeue
|--------------------------------------------------------------------------
*/

export const adminPaymentWebhookRequeueRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: z.strictObject({
    webhookEventId: webhookEventIdSchema,
  }),

  query: emptyObjectSchema,
});
