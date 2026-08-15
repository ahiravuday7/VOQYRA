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
| Payment Transaction ObjectId
|--------------------------------------------------------------------------
*/

const paymentTransactionIdSchema = z
  .string({
    error: "Payment Transaction ID must be a string",
  })
  .trim()
  .regex(OBJECT_ID_PATTERN, {
    error: "Payment Transaction ID must be a valid ObjectId",
  });

/*
|--------------------------------------------------------------------------
| Razorpay Payment Confirmation Values
|--------------------------------------------------------------------------
*/

const razorpayOrderIdSchema = z
  .string({
    error: "Razorpay Order ID is required",
  })
  .trim()
  .min(1, {
    error: "Razorpay Order ID is required",
  })
  .max(300, {
    error: "Razorpay Order ID is too long",
  });

const razorpayPaymentIdSchema = z
  .string({
    error: "Razorpay Payment ID is required",
  })
  .trim()
  .min(1, {
    error: "Razorpay Payment ID is required",
  })
  .max(300, {
    error: "Razorpay Payment ID is too long",
  });

const razorpaySignatureSchema = z
  .string({
    error: "Razorpay Payment signature is required",
  })
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/, {
    error: "Razorpay Payment signature is invalid",
  });

/*
|--------------------------------------------------------------------------
| Customer Razorpay Payment Confirmation Body
|--------------------------------------------------------------------------
*/

const confirmCustomerRazorpayPaymentBodySchema = z.strictObject({
  razorpay_order_id: razorpayOrderIdSchema,

  razorpay_payment_id: razorpayPaymentIdSchema,

  razorpay_signature: razorpaySignatureSchema,
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

/*
|--------------------------------------------------------------------------
| Customer Razorpay Payment Confirmation Request
|--------------------------------------------------------------------------
|
| POST
|
| /api/v1/orders/:orderId/payments/:paymentTransactionId/confirm
|--------------------------------------------------------------------------
*/

export const confirmCustomerRazorpayPaymentRequestSchema = z.strictObject({
  body: confirmCustomerRazorpayPaymentBodySchema,

  params: z.strictObject({
    orderId: objectIdSchema,

    paymentTransactionId: paymentTransactionIdSchema,
  }),

  query: emptyObjectSchema,
});
