import {
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

import AppError from "../../shared/errors/app-error.js";

import { findCustomerOrderById } from "../orders/order.repository.js";

import {
  findActivePaymentTransactionForOrder,
  findLatestPaymentTransactionForOrder,
  findSuccessfulPaymentTransactionForOrder,
} from "./payment.repository.js";

/*
|--------------------------------------------------------------------------
| Payment Planning Errors
|--------------------------------------------------------------------------
*/

const createOnlinePaymentOrderNotFoundError = () => {
  return new AppError("Order was not found", 404, {
    errorCode: "ORDER_NOT_FOUND",
  });
};

const createOnlinePaymentMethodInvalidError = (paymentMethod) => {
  return new AppError("Online payment cannot be started for this Order", 409, {
    errorCode: "ORDER_ONLINE_PAYMENT_METHOD_INVALID",

    details: {
      paymentMethod: paymentMethod ?? null,
    },
  });
};

const createOnlinePaymentOrderStatusInvalidError = (status) => {
  return new AppError(
    "Online payment cannot be started in the current Order state",
    409,
    {
      errorCode: "ORDER_ONLINE_PAYMENT_STATUS_INVALID",

      details: {
        status: status ?? null,
      },
    },
  );
};

const createOnlinePaymentStateInvalidError = (paymentStatus) => {
  return new AppError(
    "Online payment cannot be started in the current payment state",
    409,
    {
      errorCode: "ORDER_ONLINE_PAYMENT_STATE_INVALID",

      details: {
        paymentStatus: paymentStatus ?? null,
      },
    },
  );
};

const createOnlinePaymentInventoryStateInvalidError = (inventoryStatus) => {
  return new AppError(
    "Online payment cannot be started because the Order inventory reservation is invalid",
    409,
    {
      errorCode: "ORDER_ONLINE_PAYMENT_INVENTORY_STATE_INVALID",

      details: {
        inventoryStatus: inventoryStatus ?? null,
      },
    },
  );
};

const createOnlinePaymentAmountInvalidError = () => {
  return new AppError("Order payment amount is invalid", 409, {
    errorCode: "ORDER_ONLINE_PAYMENT_AMOUNT_INVALID",
  });
};

const createActivePaymentProviderConflictError = (
  existingProvider,
  requestedProvider,
) => {
  return new AppError(
    "Another Payment attempt is already active for this Order",
    409,
    {
      errorCode: "ORDER_PAYMENT_ATTEMPT_ALREADY_ACTIVE",

      details: {
        existingProvider,

        requestedProvider,
      },
    },
  );
};

const createPaymentStateConflictError = () => {
  return new AppError(
    "The Order payment state does not match its Payment transaction history",
    409,
    {
      errorCode: "ORDER_PAYMENT_STATE_CONFLICT",
    },
  );
};

const createPaymentAttemptNumberInvalidError = () => {
  return new AppError(
    "Unable to calculate the next Payment attempt number",
    409,
    {
      errorCode: "ORDER_PAYMENT_ATTEMPT_NUMBER_INVALID",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Assert Order Can Start Online Payment
|--------------------------------------------------------------------------
*/

export const assertOrderCanStartOnlinePayment = (order) => {
  /*
    |--------------------------------------------------------------------------
    | Online Payment Method Only
    |--------------------------------------------------------------------------
    */

  if (order.payment?.method !== ORDER_PAYMENT_METHODS.ONLINE) {
    throw createOnlinePaymentMethodInvalidError(order.payment?.method);
  }

  /*
    |--------------------------------------------------------------------------
    | Order Must Still Be Pending
    |--------------------------------------------------------------------------
    |
    | Online Orders cannot be confirmed until payment succeeds.
    |--------------------------------------------------------------------------
    */

  if (order.status !== ORDER_STATUSES.PENDING) {
    throw createOnlinePaymentOrderStatusInvalidError(order.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Payment Must Still Be Pending
    |--------------------------------------------------------------------------
    |
    | Failed provider attempts live in PaymentTransaction history.
    |
    | Order.payment remains the Order-level payment summary until a trusted
    | provider success changes it to paid.
    |--------------------------------------------------------------------------
    */

  if (order.payment?.status !== ORDER_PAYMENT_STATUSES.PENDING) {
    throw createOnlinePaymentStateInvalidError(order.payment?.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Inventory Must Still Be Reserved
    |--------------------------------------------------------------------------
    */

  if (order.inventoryStatus !== ORDER_INVENTORY_STATUSES.RESERVED) {
    throw createOnlinePaymentInventoryStateInvalidError(order.inventoryStatus);
  }

  /*
    |--------------------------------------------------------------------------
    | Trusted Amount
    |--------------------------------------------------------------------------
    */

  const amount = Number(order.totals?.grandTotal);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw createOnlinePaymentAmountInvalidError();
  }

  const currency = order.totals?.currency;

  if (typeof currency !== "string" || currency.trim().length === 0) {
    throw createOnlinePaymentAmountInvalidError();
  }

  return {
    amount,

    currency: currency.trim().toUpperCase(),
  };
};

/*
|--------------------------------------------------------------------------
| Build Next Payment Attempt Number
|--------------------------------------------------------------------------
*/

export const buildNextPaymentAttemptNumber = (latestPaymentTransaction) => {
  if (!latestPaymentTransaction) {
    return 1;
  }

  const currentAttempt = Number(latestPaymentTransaction.attemptNumber);

  if (!Number.isSafeInteger(currentAttempt) || currentAttempt < 1) {
    throw createPaymentAttemptNumberInvalidError();
  }

  const nextAttempt = currentAttempt + 1;

  if (!Number.isSafeInteger(nextAttempt)) {
    throw createPaymentAttemptNumberInvalidError();
  }

  return nextAttempt;
};

/*
|--------------------------------------------------------------------------
| Build Trusted Online Payment Plan
|--------------------------------------------------------------------------
|
| No database write happens here.
|--------------------------------------------------------------------------
*/

export const buildTrustedOnlinePaymentPlan = (
  order,
  { provider, attemptNumber },
) => {
  const { amount, currency } = assertOrderCanStartOnlinePayment(order);

  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw createPaymentAttemptNumberInvalidError();
  }

  return {
    orderId: order._id,

    orderNumber: order.orderNumber,

    customerId: order.customer,

    provider,

    amount,

    currency,

    attemptNumber,
  };
};

/*
|--------------------------------------------------------------------------
| Prepare Customer Online Payment
|--------------------------------------------------------------------------
|
| This Part does not create the PaymentTransaction yet.
|
| It decides:
|
| REUSE existing attempt
|
| or
|
| CREATE a new attempt
|--------------------------------------------------------------------------
*/

export const prepareCustomerOnlinePayment = async ({
  orderId,
  customerId,
  provider,
}) => {
  if (!customerId) {
    throw new Error("Customer ID is required to prepare online payment");
  }

  if (!provider) {
    throw new Error("Payment provider is required");
  }

  /*
    |--------------------------------------------------------------------------
    | Load Owned Order
    |--------------------------------------------------------------------------
    |
    | Ownership is enforced in MongoDB:
    |
    | _id + customer
    |--------------------------------------------------------------------------
    */

  const order = await findCustomerOrderById(orderId, customerId);

  if (!order) {
    /*
     * Same 404 whether:
     *
     * Order does not exist
     * or
     * Order belongs to another customer
     */

    throw createOnlinePaymentOrderNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Trusted Order State First
    |--------------------------------------------------------------------------
    */

  assertOrderCanStartOnlinePayment(order);

  /*
    |--------------------------------------------------------------------------
    | Successful Transaction Safety Check
    |--------------------------------------------------------------------------
    |
    | This protects against:
    |
    | PaymentTransaction = paid
    | Order.payment      = pending
    |
    | which could otherwise cause a double charge.
    |--------------------------------------------------------------------------
    */

  const successfulPayment = await findSuccessfulPaymentTransactionForOrder(
    order._id,
  );

  if (successfulPayment) {
    throw createPaymentStateConflictError();
  }

  /*
    |--------------------------------------------------------------------------
    | Idempotency — Existing Active Attempt
    |--------------------------------------------------------------------------
    */

  const activePayment = await findActivePaymentTransactionForOrder(order._id);

  if (activePayment) {
    /*
     * Same provider:
     *
     * reuse the current attempt.
     */

    if (activePayment.provider === provider) {
      return {
        action: "reuse",

        order,

        paymentTransaction: activePayment,

        plan: buildTrustedOnlinePaymentPlan(order, {
          provider: activePayment.provider,

          attemptNumber: activePayment.attemptNumber,
        }),
      };
    }

    /*
     * Different provider while another payment is active:
     *
     * do not create a second potentially chargeable payment.
     */

    throw createActivePaymentProviderConflictError(
      activePayment.provider,

      provider,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | New Attempt
    |--------------------------------------------------------------------------
    */

  const latestPayment = await findLatestPaymentTransactionForOrder(order._id);

  const attemptNumber = buildNextPaymentAttemptNumber(latestPayment);

  const plan = buildTrustedOnlinePaymentPlan(order, {
    provider,

    attemptNumber,
  });

  return {
    action: "create",

    order,

    paymentTransaction: null,

    plan,
  };
};
