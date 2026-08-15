import crypto from "node:crypto";

import { PAYMENT_PROVIDERS } from "../../src/modules/payments/payment.model.js";

/*
|--------------------------------------------------------------------------
| Test Razorpay Checkout
|--------------------------------------------------------------------------
*/

const buildTestCheckoutData = ({
  providerOrderId,

  amount,

  currency,
}) => {
  return {
    keyId: "rzp_test_integration_key",

    orderId: providerOrderId,

    amount: amount * 100,

    currency: currency.toUpperCase(),
  };
};

/*
|--------------------------------------------------------------------------
| Test Razorpay Secret
|--------------------------------------------------------------------------
*/

const TEST_RAZORPAY_KEY_SECRET = "clothing-commerce-test-razorpay-secret";

/*
|--------------------------------------------------------------------------
| Create Test Razorpay Signature
|--------------------------------------------------------------------------
|
| Used by integration tests to simulate the value returned by Razorpay
| Checkout.
|--------------------------------------------------------------------------
*/

export const createTestRazorpaySignature = ({
  providerOrderId,

  providerPaymentId,
}) => {
  return crypto
    .createHmac(
      "sha256",

      TEST_RAZORPAY_KEY_SECRET,
    )
    .update(`${providerOrderId}|${providerPaymentId}`)
    .digest("hex");
};

/*
|--------------------------------------------------------------------------
| Test Razorpay Provider Adapter
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Integration tests must never call the real Razorpay network.
|--------------------------------------------------------------------------
*/

export const testRazorpayPaymentProviderAdapter = Object.freeze({
  provider: PAYMENT_PROVIDERS.RAZORPAY,

  buildCheckoutData({
    providerOrderId,

    amount,

    currency,
  }) {
    return buildTestCheckoutData({
      providerOrderId,

      amount,

      currency,
    });
  },

  verifyPaymentConfirmation({
    providerOrderId,

    providerPaymentId,

    signature,
  }) {
    const expectedSignature = createTestRazorpaySignature({
      providerOrderId,

      providerPaymentId,
    });

    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    const receivedBuffer = Buffer.from(signature, "hex");

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      expectedBuffer,

      receivedBuffer,
    );
  },

  async createPaymentSession({
    paymentNumber,

    amount,

    currency,
  }) {
    /*
     * Deterministic provider Order ID.
     */

    const normalizedReference = paymentNumber.replace(/[^A-Za-z0-9]/g, "");

    const providerOrderId = `order_test_${normalizedReference}`;

    return {
      providerOrderId,

      amount,

      currency: currency.toUpperCase(),

      status: "created",

      checkout: buildTestCheckoutData({
        providerOrderId,

        amount,

        currency,
      }),
    };
  },
});
