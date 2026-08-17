import { describe, expect, it } from "vitest";

import { PAYMENT_PROVIDERS } from "../../src/modules/payments/payment.model.js";

import { fetchAndVerifyPaymentProviderDetails } from "../../src/modules/payments/providers/payment-provider.service.js";

import { setTestRazorpayPaymentDetails } from "../helpers/payment-provider-test.helper.js";

/*
|--------------------------------------------------------------------------
| Part 189 — Provider Payment Details Verification
|--------------------------------------------------------------------------
*/

describe("Payment provider details verification", () => {
  const trustedPayment = {
    provider: PAYMENT_PROVIDERS.RAZORPAY,

    providerPaymentId: "pay_test_part189",

    providerOrderId: "order_test_part189",

    amount: 899,

    currency: "INR",
  };

  /*
    |--------------------------------------------------------------------------
    | Valid Provider Payment
    |--------------------------------------------------------------------------
    */

  it("fetches provider Payment details and verifies trusted identifiers, amount, and currency", async () => {
    setTestRazorpayPaymentDetails({
      ...trustedPayment,

      status: "captured",

      captured: true,

      method: "upi",
    });

    const result = await fetchAndVerifyPaymentProviderDetails(trustedPayment);

    expect(result).toEqual({
      ...trustedPayment,

      status: "captured",

      captured: true,

      method: "upi",
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Wrong Provider Order
    |--------------------------------------------------------------------------
    */

  it("rejects a provider Payment attached to another provider Order", async () => {
    setTestRazorpayPaymentDetails({
      ...trustedPayment,

      providerOrderId: "order_test_wrong",
    });

    await expect(
      fetchAndVerifyPaymentProviderDetails(trustedPayment),
    ).rejects.toThrow(
      "Payment provider returned a different Order ID than expected",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Wrong Amount
    |--------------------------------------------------------------------------
    */

  it("rejects a provider Payment with a different amount", async () => {
    setTestRazorpayPaymentDetails({
      ...trustedPayment,

      amount: 1,
    });

    await expect(
      fetchAndVerifyPaymentProviderDetails(trustedPayment),
    ).rejects.toThrow(
      "Payment provider returned a different amount than expected",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Wrong Currency
    |--------------------------------------------------------------------------
    */

  it("rejects a provider Payment with a different currency", async () => {
    setTestRazorpayPaymentDetails({
      ...trustedPayment,

      currency: "USD",
    });

    await expect(
      fetchAndVerifyPaymentProviderDetails(trustedPayment),
    ).rejects.toThrow(
      "Payment provider returned a different currency than expected",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Authorized Is NOT Captured
    |--------------------------------------------------------------------------
    */

  it("returns authorized state without pretending that the Payment is captured", async () => {
    setTestRazorpayPaymentDetails({
      ...trustedPayment,

      status: "authorized",

      captured: false,
    });

    const result = await fetchAndVerifyPaymentProviderDetails(trustedPayment);

    expect(result.status).toBe("authorized");

    expect(result.captured).toBe(false);
  });
});
