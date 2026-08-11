/*
|--------------------------------------------------------------------------
| Payment Provider Adapter Contract
|--------------------------------------------------------------------------
|
| Every external Payment provider must implement:
|
| createPaymentSession()
|
| Examples later:
|
| Razorpay -> create Razorpay Order
| Stripe   -> create PaymentIntent
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Non-Empty String
|--------------------------------------------------------------------------
*/

const isNonEmptyString = (value) => {
  return typeof value === "string" && value.trim().length > 0;
};

/*
|--------------------------------------------------------------------------
| Assert Provider Adapter
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderAdapter = (adapter) => {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("Payment provider adapter must be an object");
  }

  if (!isNonEmptyString(adapter.provider)) {
    throw new TypeError("Payment provider adapter must define provider");
  }

  if (typeof adapter.createPaymentSession !== "function") {
    throw new TypeError(
      "Payment provider adapter must implement createPaymentSession",
    );
  }

  return adapter;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Session Input
|--------------------------------------------------------------------------
|
| Provider implementations receive only trusted backend values.
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderSessionInput = (input) => {
  if (!input || typeof input !== "object") {
    throw new TypeError("Payment provider session input is required");
  }

  if (!isNonEmptyString(input.paymentNumber)) {
    throw new TypeError("Payment number is required");
  }

  if (!isNonEmptyString(input.orderNumber)) {
    throw new TypeError("Order number is required");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new TypeError("Payment amount must be a positive integer");
  }

  if (!isNonEmptyString(input.currency)) {
    throw new TypeError("Payment currency is required");
  }

  return input;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Session Result
|--------------------------------------------------------------------------
|
| Provider adapters normalize their response into this common structure.
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderSessionResult = (result) => {
  if (!result || typeof result !== "object") {
    throw new TypeError("Payment provider session result is required");
  }

  if (!isNonEmptyString(result.providerOrderId)) {
    throw new TypeError(
      "Payment provider session must contain providerOrderId",
    );
  }

  if (!Number.isSafeInteger(result.amount) || result.amount <= 0) {
    throw new TypeError("Payment provider session amount is invalid");
  }

  if (!isNonEmptyString(result.currency)) {
    throw new TypeError("Payment provider session currency is invalid");
  }

  if (
    result.checkout !== undefined &&
    (!result.checkout ||
      typeof result.checkout !== "object" ||
      Array.isArray(result.checkout))
  ) {
    throw new TypeError("Payment provider checkout data must be an object");
  }

  return result;
};
