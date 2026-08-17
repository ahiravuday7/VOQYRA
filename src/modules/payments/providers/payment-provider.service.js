import {
  assertPaymentProviderSessionInput,
  assertPaymentProviderSessionResult,
  assertPaymentProviderCheckoutInput,
  assertPaymentProviderCheckoutResult,
  assertPaymentProviderConfirmationInput,
  assertPaymentProviderConfirmationResult,
  assertPaymentProviderDetailsInput,
  assertPaymentProviderDetailsResult,
} from "./payment-provider.contract.js";

import { getPaymentProvider } from "./payment-provider.registry.js";

/*
|--------------------------------------------------------------------------
| Create Payment Provider Session
|--------------------------------------------------------------------------
|
| Provider-neutral gateway orchestration.
|--------------------------------------------------------------------------
*/

export const createPaymentProviderSession = async ({
  provider,

  paymentNumber,

  orderNumber,

  amount,

  currency,

  customerId,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Trusted Session Input
    |--------------------------------------------------------------------------
    */

  const input = {
    paymentNumber,

    orderNumber,

    amount,

    currency,

    customerId: customerId ?? null,
  };

  assertPaymentProviderSessionInput(input);

  /*
    |--------------------------------------------------------------------------
    | Resolve Provider Adapter
    |--------------------------------------------------------------------------
    */

  const adapter = getPaymentProvider(provider);

  /*
    |--------------------------------------------------------------------------
    | External Provider Call
    |--------------------------------------------------------------------------
    |
    | Razorpay/Stripe implementation lives inside the adapter.
    |--------------------------------------------------------------------------
    */

  const result = await adapter.createPaymentSession(input);

  /*
    |--------------------------------------------------------------------------
    | Normalize / Validate Provider Response
    |--------------------------------------------------------------------------
    */

  assertPaymentProviderSessionResult(result);

  /*
    |--------------------------------------------------------------------------
    | Provider Integrity Check
    |--------------------------------------------------------------------------
    |
    | A provider must not silently alter the trusted amount/currency.
    |--------------------------------------------------------------------------
    */

  if (result.amount !== amount) {
    throw new Error(
      "Payment provider returned a different amount than requested",
    );
  }

  if (result.currency.toUpperCase() !== currency.toUpperCase()) {
    throw new Error(
      "Payment provider returned a different currency than requested",
    );
  }

  return {
    provider,

    providerOrderId: result.providerOrderId,

    amount: result.amount,

    currency: result.currency.toUpperCase(),

    status: result.status ?? "created",

    checkout: result.checkout ?? {},
  };
};

/*
|--------------------------------------------------------------------------
| Build Payment Provider Checkout Data
|--------------------------------------------------------------------------
|
| No external Order is created here.
|
| This reconstructs safe frontend Checkout data from the persisted
| providerReference.orderId.
|--------------------------------------------------------------------------
*/

export const buildPaymentProviderCheckoutData = ({
  provider,

  providerOrderId,

  amount,

  currency,
}) => {
  const input = {
    providerOrderId,

    amount,

    currency,
  };

  assertPaymentProviderCheckoutInput(input);

  const adapter = getPaymentProvider(provider);

  const checkout = adapter.buildCheckoutData(input);

  assertPaymentProviderCheckoutResult(checkout);

  return checkout;
};

/*
|--------------------------------------------------------------------------
| Verify Payment Provider Confirmation
|--------------------------------------------------------------------------
*/

export const verifyPaymentProviderConfirmation = ({
  provider,

  providerOrderId,

  providerPaymentId,

  signature,
}) => {
  const input = {
    providerOrderId,

    providerPaymentId,

    signature,
  };

  assertPaymentProviderConfirmationInput(input);

  const adapter = getPaymentProvider(provider);

  const verified = adapter.verifyPaymentConfirmation(input);

  assertPaymentProviderConfirmationResult(verified);

  return verified;
};

/*
|--------------------------------------------------------------------------
| Fetch And Verify Payment Provider Details
|--------------------------------------------------------------------------
|
| Signature verification proves the Checkout response is authentic.
|
| This second verification asks the provider directly for the Payment and
| compares it with trusted PaymentTransaction values from our database.
|
| No local Payment/Order state is changed in Part 189.
|--------------------------------------------------------------------------
*/

export const fetchAndVerifyPaymentProviderDetails = async ({
  provider,

  providerPaymentId,

  providerOrderId,

  amount,

  currency,
}) => {
  const input = {
    providerPaymentId,

    providerOrderId,

    amount,

    currency,
  };

  assertPaymentProviderDetailsInput(input);

  const adapter = getPaymentProvider(provider);

  /*
  |--------------------------------------------------------------------------
  | Provider Lookup
  |--------------------------------------------------------------------------
  |
  | Important:
  |
  | Only providerPaymentId goes to the provider adapter.
  |
  | We do NOT give the adapter our expected amount/order/currency and then
  | blindly trust the same values coming back.
  |--------------------------------------------------------------------------
  */

  const details = await adapter.fetchPaymentDetails({
    providerPaymentId,
  });

  assertPaymentProviderDetailsResult(details);

  /*
  |--------------------------------------------------------------------------
  | Payment ID Integrity
  |--------------------------------------------------------------------------
  */

  if (details.providerPaymentId !== providerPaymentId) {
    throw new Error(
      "Payment provider returned a different Payment ID than requested",
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Provider Order Integrity
  |--------------------------------------------------------------------------
  */

  if (details.providerOrderId !== providerOrderId) {
    throw new Error(
      "Payment provider returned a different Order ID than expected",
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Trusted Amount Integrity
  |--------------------------------------------------------------------------
  */

  if (details.amount !== amount) {
    throw new Error(
      "Payment provider returned a different amount than expected",
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Trusted Currency Integrity
  |--------------------------------------------------------------------------
  */

  if (details.currency.toUpperCase() !== currency.toUpperCase()) {
    throw new Error(
      "Payment provider returned a different currency than expected",
    );
  }

  return {
    provider,

    providerPaymentId: details.providerPaymentId,

    providerOrderId: details.providerOrderId,

    amount: details.amount,

    currency: details.currency.toUpperCase(),

    status: details.status.toLowerCase(),

    captured: details.captured,

    method: details.method ?? null,
  };
};
