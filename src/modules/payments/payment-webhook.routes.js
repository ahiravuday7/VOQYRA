import express, { Router } from "express";

import { receiveRazorpayPaymentWebhookController } from "./payment-webhook.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Razorpay Payment Webhook
|--------------------------------------------------------------------------
|
| POST
|
| /api/v1/webhooks/payments/razorpay
|
| IMPORTANT:
|
| express.raw() is mandatory.
|
| This router MUST be mounted before express.json().
|--------------------------------------------------------------------------
*/

router.post(
  "/razorpay",

  express.raw({
    type: "application/json",

    limit: "256kb",
  }),

  receiveRazorpayPaymentWebhookController,
);

export default router;
