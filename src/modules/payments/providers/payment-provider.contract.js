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

  if (typeof adapter.buildCheckoutData !== "function") {
    throw new TypeError(
      "Payment provider adapter must implement buildCheckoutData",
    );
  }

  if (typeof adapter.verifyPaymentConfirmation !== "function") {
    throw new TypeError(
      "Payment provider adapter must implement verifyPaymentConfirmation",
    );
  }

  if (typeof adapter.fetchPaymentDetails !== "function") {
    throw new TypeError(
      "Payment provider adapter must implement fetchPaymentDetails",
    );
  }

  return adapter;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Provider Confirmation Input
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderConfirmationInput = (input) => {
  if (!input || typeof input !== "object") {
    throw new TypeError("Payment provider confirmation input is required");
  }

  if (
    typeof input.providerOrderId !== "string" ||
    input.providerOrderId.trim().length === 0
  ) {
    throw new TypeError("Payment provider Order ID is required");
  }

  if (
    typeof input.providerPaymentId !== "string" ||
    input.providerPaymentId.trim().length === 0
  ) {
    throw new TypeError("Payment provider Payment ID is required");
  }

  if (
    typeof input.signature !== "string" ||
    input.signature.trim().length === 0
  ) {
    throw new TypeError("Payment provider signature is required");
  }

  return input;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Provider Confirmation Result
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderConfirmationResult = (result) => {
  if (typeof result !== "boolean") {
    throw new TypeError(
      "Payment provider confirmation verification must return a boolean",
    );
  }

  return result;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Provider Details Input
|--------------------------------------------------------------------------
|
| These values come from trusted backend PaymentTransaction state.
|
| Only providerPaymentId is sent to the provider adapter.
| The remaining values are used after the provider response returns to
| verify that Razorpay did not return a different payment relationship.
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderDetailsInput = (input) => {
  if (!input || typeof input !== "object") {
    throw new TypeError("Payment provider details input is required");
  }

  if (!isNonEmptyString(input.providerPaymentId)) {
    throw new TypeError("Payment provider Payment ID is required");
  }

  if (!isNonEmptyString(input.providerOrderId)) {
    throw new TypeError("Payment provider Order ID is required");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new TypeError("Payment provider expected amount is invalid");
  }

  if (!isNonEmptyString(input.currency)) {
    throw new TypeError("Payment provider expected currency is invalid");
  }

  return input;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Provider Details Result
|--------------------------------------------------------------------------
|
| Every provider adapter normalizes its payment lookup into this shape.
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderDetailsResult = (result) => {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("Payment provider details result is required");
  }

  if (!isNonEmptyString(result.providerPaymentId)) {
    throw new TypeError(
      "Payment provider details must contain providerPaymentId",
    );
  }

  if (!isNonEmptyString(result.providerOrderId)) {
    throw new TypeError(
      "Payment provider details must contain providerOrderId",
    );
  }

  if (!Number.isSafeInteger(result.amount) || result.amount <= 0) {
    throw new TypeError("Payment provider details amount is invalid");
  }

  if (!isNonEmptyString(result.currency)) {
    throw new TypeError("Payment provider details currency is invalid");
  }

  if (!isNonEmptyString(result.status)) {
    throw new TypeError("Payment provider details status is invalid");
  }

  if (typeof result.captured !== "boolean") {
    throw new TypeError("Payment provider captured flag must be a boolean");
  }

  if (
    result.method !== null &&
    result.method !== undefined &&
    !isNonEmptyString(result.method)
  ) {
    throw new TypeError("Payment provider method is invalid");
  }

  return result;
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

/*
|--------------------------------------------------------------------------
| Assert Payment Checkout Input
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderCheckoutInput = (input) => {
  if (!input || typeof input !== "object") {
    throw new TypeError("Payment provider checkout input is required");
  }

  if (!isNonEmptyString(input.providerOrderId)) {
    throw new TypeError("Payment provider Order ID is required");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new TypeError("Payment checkout amount is invalid");
  }

  if (!isNonEmptyString(input.currency)) {
    throw new TypeError("Payment checkout currency is invalid");
  }

  return input;
};

/*
|--------------------------------------------------------------------------
| Assert Payment Checkout Result
|--------------------------------------------------------------------------
*/

export const assertPaymentProviderCheckoutResult = (checkout) => {
  if (!checkout || typeof checkout !== "object" || Array.isArray(checkout)) {
    throw new TypeError("Payment provider checkout data must be an object");
  }

  return checkout;
};
