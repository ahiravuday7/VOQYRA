import Razorpay from "razorpay";

import env from "../../../config/environment.js";

import { PAYMENT_PROVIDERS } from "../payment.model.js";

/*
|--------------------------------------------------------------------------
| Razorpay Currency Configuration
|--------------------------------------------------------------------------
|
| Current application Orders support INR only.
|
| Our application stores:
|
| ₹899 -> 899
|
| Razorpay expects the smallest currency subunit:
|
| ₹899 -> 89900 paise
|--------------------------------------------------------------------------
*/

const INR_SUBUNIT_FACTOR = 100;

/*
|--------------------------------------------------------------------------
| Razorpay Client
|--------------------------------------------------------------------------
*/

const razorpayClient = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,

  key_secret: env.RAZORPAY_KEY_SECRET,
});

/*
|--------------------------------------------------------------------------
| Convert Trusted Amount To Razorpay Amount
|--------------------------------------------------------------------------
*/

const toRazorpayAmount = (amount) => {
  const providerAmount = amount * INR_SUBUNIT_FACTOR;

  if (!Number.isSafeInteger(providerAmount) || providerAmount <= 0) {
    throw new Error("Razorpay Payment amount could not be converted safely");
  }

  return providerAmount;
};

/*
|--------------------------------------------------------------------------
| Convert Razorpay Amount To Application Amount
|--------------------------------------------------------------------------
*/

const fromRazorpayAmount = (amount) => {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount % INR_SUBUNIT_FACTOR !== 0
  ) {
    throw new Error("Razorpay returned an invalid Payment amount");
  }

  return amount / INR_SUBUNIT_FACTOR;
};

/*
|--------------------------------------------------------------------------
| Build Razorpay Checkout Data
|--------------------------------------------------------------------------
*/

const buildRazorpayCheckoutData = ({
  providerOrderId,

  amount,

  currency,
}) => {
  const normalizedCurrency = currency.trim().toUpperCase();

  return {
    keyId: env.RAZORPAY_KEY_ID,

    orderId: providerOrderId,

    amount: toRazorpayAmount(amount),

    currency: normalizedCurrency,
  };
};

/*
|--------------------------------------------------------------------------
| Razorpay Payment Provider Adapter
|--------------------------------------------------------------------------
*/

const razorpayPaymentProviderAdapter = Object.freeze({
  provider: PAYMENT_PROVIDERS.RAZORPAY,

  buildCheckoutData({
    providerOrderId,

    amount,

    currency,
  }) {
    return buildRazorpayCheckoutData({
      providerOrderId,

      amount,

      currency,
    });
  },

  async createPaymentSession({
    paymentNumber,

    orderNumber,

    amount,

    currency,

    customerId,
  }) {
    /*
    |--------------------------------------------------------------------------
    | Currency Guard
    |--------------------------------------------------------------------------
    */

    const normalizedCurrency = currency.trim().toUpperCase();

    if (normalizedCurrency !== "INR") {
      throw new Error("Razorpay Payment provider currently supports INR only");
    }

    /*
    |--------------------------------------------------------------------------
    | Provider Amount
    |--------------------------------------------------------------------------
    */

    const providerAmount = toRazorpayAmount(amount);

    /*
    |--------------------------------------------------------------------------
    | Create Razorpay Order
    |--------------------------------------------------------------------------
    */

    const razorpayOrder = await razorpayClient.orders.create({
      amount: providerAmount,

      currency: normalizedCurrency,

      receipt: paymentNumber,

      notes: {
        paymentNumber,

        orderNumber,

        ...(customerId
          ? {
              customerId: String(customerId),
            }
          : {}),
      },
    });

    /*
    |--------------------------------------------------------------------------
    | Normalize Provider Response
    |--------------------------------------------------------------------------
    */

    return {
      providerOrderId: razorpayOrder.id,

      amount: fromRazorpayAmount(razorpayOrder.amount),

      currency: razorpayOrder.currency,

      status: razorpayOrder.status,

      checkout: buildRazorpayCheckoutData({
        providerOrderId: razorpayOrder.id,

        amount,

        currency: razorpayOrder.currency,
      }),
    };
  },
});

export default razorpayPaymentProviderAdapter;
