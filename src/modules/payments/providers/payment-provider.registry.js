import AppError from "../../../shared/errors/app-error.js";

import { PAYMENT_PROVIDER_VALUES } from "../payment.model.js";

import { assertPaymentProviderAdapter } from "./payment-provider.contract.js";

/*
|--------------------------------------------------------------------------
| Payment Provider Registry
|--------------------------------------------------------------------------
*/

const paymentProviderRegistry = new Map();

/*
|--------------------------------------------------------------------------
| Validate Provider Name
|--------------------------------------------------------------------------
*/

const assertKnownPaymentProvider = (provider) => {
  if (!PAYMENT_PROVIDER_VALUES.includes(provider)) {
    throw new Error(`Unsupported Payment provider: ${provider}`);
  }
};

/*
|--------------------------------------------------------------------------
| Register Payment Provider
|--------------------------------------------------------------------------
|
| Registration normally happens once during application initialization.
|--------------------------------------------------------------------------
*/

export const registerPaymentProvider = (adapter) => {
  assertPaymentProviderAdapter(adapter);

  assertKnownPaymentProvider(adapter.provider);

  if (paymentProviderRegistry.has(adapter.provider)) {
    throw new Error(
      `Payment provider is already registered: ${adapter.provider}`,
    );
  }

  paymentProviderRegistry.set(adapter.provider, adapter);

  return adapter;
};

/*
|--------------------------------------------------------------------------
| Has Payment Provider
|--------------------------------------------------------------------------
*/

export const hasPaymentProvider = (provider) => {
  return paymentProviderRegistry.has(provider);
};

/*
|--------------------------------------------------------------------------
| Get Payment Provider
|--------------------------------------------------------------------------
*/

export const getPaymentProvider = (provider) => {
  assertKnownPaymentProvider(provider);

  const adapter = paymentProviderRegistry.get(provider);

  if (!adapter) {
    throw new AppError(
      "The selected Payment provider is currently unavailable",
      503,
      {
        errorCode: "PAYMENT_PROVIDER_UNAVAILABLE",

        details: {
          provider,
        },
      },
    );
  }

  return adapter;
};
