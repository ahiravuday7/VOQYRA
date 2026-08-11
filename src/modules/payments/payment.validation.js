import { z } from "zod";

import { PAYMENT_PROVIDER_VALUES } from "./payment.model.js";

/*
|--------------------------------------------------------------------------
| Payment Validation Values
|--------------------------------------------------------------------------
*/

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/*
|--------------------------------------------------------------------------
| ObjectId
|--------------------------------------------------------------------------
*/

const objectIdSchema = z
  .string({
    error: "Order ID must be a string",
  })
  .trim()
  .regex(OBJECT_ID_PATTERN, {
    error: "Order ID must be a valid ObjectId",
  });

/*
|--------------------------------------------------------------------------
| Empty Request Object
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({}),
);

/*
|--------------------------------------------------------------------------
| Customer Online Payment Body
|--------------------------------------------------------------------------
|
| Important:
|
| Customer may choose an allowed provider.
|
| Customer MUST NOT send:
|
| amount
| currency
| payment status
| provider payment ID
| success flag
|--------------------------------------------------------------------------
*/

const createCustomerOnlinePaymentBodySchema = z.strictObject({
  provider: z.enum(PAYMENT_PROVIDER_VALUES, {
    error: "Payment provider is invalid",
  }),
});

/*
|--------------------------------------------------------------------------
| Create Customer Online Payment Request
|--------------------------------------------------------------------------
|
| Future endpoint:
|
| POST /api/v1/orders/:orderId/payments
|--------------------------------------------------------------------------
*/

export const createCustomerOnlinePaymentRequestSchema = z.strictObject({
  body: createCustomerOnlinePaymentBodySchema,

  params: z.strictObject({
    orderId: objectIdSchema,
  }),

  query: emptyObjectSchema,
});
