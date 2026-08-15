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
