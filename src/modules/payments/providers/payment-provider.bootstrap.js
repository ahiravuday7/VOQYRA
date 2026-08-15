import { PAYMENT_PROVIDERS } from "../payment.model.js";

import {
  hasPaymentProvider,
  registerPaymentProvider,
} from "./payment-provider.registry.js";

import razorpayPaymentProviderAdapter from "./razorpay-payment-provider.adapter.js";

/*
|--------------------------------------------------------------------------
| Initialize Payment Providers
|--------------------------------------------------------------------------
|
| Called once while the application is initialized.
|--------------------------------------------------------------------------
*/

export const initializePaymentProviders = () => {
  if (!hasPaymentProvider(PAYMENT_PROVIDERS.RAZORPAY)) {
    registerPaymentProvider(razorpayPaymentProviderAdapter);
  }
};
