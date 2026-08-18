import { z } from "zod";

import { PAYMENT_RECONCILIATION_RECORD_STATUSES } from "./payment.model.js";

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
| Admin Reconciliation Status Values
|--------------------------------------------------------------------------
|
| "none" is deliberately excluded.
|
| Admin observability is for reconciliation incidents/outcomes:
|
| - manual-review
| - recovered
|--------------------------------------------------------------------------
*/

const ADMIN_PAYMENT_RECONCILIATION_STATUS_VALUES = Object.freeze([
  PAYMENT_RECONCILIATION_RECORD_STATUSES.MANUAL_REVIEW,

  PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED,
]);

/*
|--------------------------------------------------------------------------
| Text Filter
|--------------------------------------------------------------------------
*/

const reconciliationTextFilterSchema = z
  .string({
    error: "Reconciliation filter must be a string",
  })
  .trim()
  .min(1, {
    error: "Reconciliation filter cannot be empty",
  })
  .max(200, {
    error: "Reconciliation filter cannot exceed 200 characters",
  });

/*
|--------------------------------------------------------------------------
| Admin Payment Reconciliation List Query
|--------------------------------------------------------------------------
*/

const adminPaymentReconciliationListQuerySchema = z
  .strictObject({
    /*
      |--------------------------------------------------------------------------
      | Pagination
      |--------------------------------------------------------------------------
      */

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

    /*
      |--------------------------------------------------------------------------
      | Reconciliation State
      |--------------------------------------------------------------------------
      */

    status: z
      .enum(ADMIN_PAYMENT_RECONCILIATION_STATUS_VALUES, {
        error: "Payment reconciliation status is invalid",
      })
      .optional(),

    /*
      |--------------------------------------------------------------------------
      | Classification Reason
      |--------------------------------------------------------------------------
      |
      | Examples:
      |
      | payment-amount-mismatch
      | order-state-conflict
      | order-requires-finalization
      |--------------------------------------------------------------------------
      */

    reason: reconciliationTextFilterSchema.optional(),

    /*
      |--------------------------------------------------------------------------
      | Useful Provider / Business References
      |--------------------------------------------------------------------------
      */

    paymentNumber: reconciliationTextFilterSchema.optional(),

    orderNumber: reconciliationTextFilterSchema.optional(),

    providerPaymentId: reconciliationTextFilterSchema.optional(),

    /*
      |--------------------------------------------------------------------------
      | Detection Date Range
      |--------------------------------------------------------------------------
      */

    from: z.coerce
      .date({
        error: "Reconciliation from date is invalid",
      })
      .optional(),

    to: z.coerce
      .date({
        error: "Reconciliation to date is invalid",
      })
      .optional(),

    /*
      |--------------------------------------------------------------------------
      | Sorting
      |--------------------------------------------------------------------------
      */

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
      error: "Reconciliation from date cannot be later than the to date",

      path: ["to"],
    },
  );

/*
|--------------------------------------------------------------------------
| Admin Payment Reconciliation List Request
|--------------------------------------------------------------------------
*/

export const adminPaymentReconciliationListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: adminPaymentReconciliationListQuerySchema,
});
