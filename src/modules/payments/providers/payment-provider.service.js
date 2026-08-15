import {
  assertPaymentProviderSessionInput,
  assertPaymentProviderSessionResult,
  assertPaymentProviderCheckoutInput,
  assertPaymentProviderCheckoutResult,
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
