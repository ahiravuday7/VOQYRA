import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../shared/constants/order.constants.js";

import AppError from "../../shared/errors/app-error.js";

import {
  findCustomerOrderById,
  findCustomerOrderForOnlinePaymentFinalization,
} from "../orders/order.repository.js";

import { finalizePaidOnlineOrderInTransaction } from "../orders/order.service.js";

import {
  findActivePaymentTransactionForOrder,
  findLatestPaymentTransactionForOrder,
  findSuccessfulPaymentTransactionForOrder,
  createPaymentTransactionDocument,
  findPaymentTransactionByOrderAndAttemptNumber,
  markPaymentProviderSessionCreationFailed,
  attachPaymentProviderOrderToTransaction,
  claimPaymentTransactionForProviderSession,
  findPaymentTransactionById,
  findCustomerPaymentTransactionForConfirmation,
  recordVerifiedPaymentProviderConfirmation,
  markVerifiedPaymentTransactionAuthorized,
  markVerifiedPaymentTransactionPaid,
} from "./payment.repository.js";

import { PAYMENT_TRANSACTION_STATUSES } from "./payment.model.js";

import {
  createPaymentProviderSession,
  buildPaymentProviderCheckoutData,
  verifyPaymentProviderConfirmation,
  fetchAndVerifyPaymentProviderDetails,
} from "./providers/payment-provider.service.js";

/*
|--------------------------------------------------------------------------
| Payment Number Values
|--------------------------------------------------------------------------
*/

const PAYMENT_NUMBER_RANDOM_BYTES = 6;

const MAX_PAYMENT_NUMBER_CREATE_ATTEMPTS = 5;

/*
|--------------------------------------------------------------------------
| Mongo Duplicate Key
|--------------------------------------------------------------------------
*/

const isMongoDuplicateKeyError = (error) => {
  return error?.code === 11000;
};

/*
|--------------------------------------------------------------------------
| Duplicate Payment Number
|--------------------------------------------------------------------------
*/

const isDuplicatePaymentNumberError = (error) => {
  if (!isMongoDuplicateKeyError(error)) {
    return false;
  }

  return (
    Object.hasOwn(error.keyPattern ?? {}, "paymentNumber") ||
    Object.hasOwn(error.keyValue ?? {}, "paymentNumber")
  );
};

/*
|--------------------------------------------------------------------------
| Duplicate Order Attempt
|--------------------------------------------------------------------------
*/

const isDuplicateOrderAttemptError = (error) => {
  if (!isMongoDuplicateKeyError(error)) {
    return false;
  }

  const keyPattern = error.keyPattern ?? {};

  const keyValue = error.keyValue ?? {};

  return (
    (Object.hasOwn(keyPattern, "order") &&
      Object.hasOwn(keyPattern, "attemptNumber")) ||
    (Object.hasOwn(keyValue, "order") &&
      Object.hasOwn(keyValue, "attemptNumber"))
  );
};

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

const createPaymentAttemptConflictError = () => {
  return new AppError(
    "The Payment attempt changed while it was being created",
    409,
    {
      errorCode: "ORDER_PAYMENT_ATTEMPT_CONFLICT",
    },
  );
};

const createPaymentNumberGenerationError = () => {
  return new AppError("Unable to create a unique Payment reference", 500, {
    errorCode: "PAYMENT_NUMBER_GENERATION_FAILED",
  });
};

/*
|--------------------------------------------------------------------------
| Payment Provider Session Errors
|--------------------------------------------------------------------------
*/

const createPaymentProviderSessionFailedError = (provider) => {
  return new AppError("Payment provider session could not be created", 502, {
    errorCode: "PAYMENT_PROVIDER_SESSION_CREATION_FAILED",

    details: {
      provider,
    },
  });
};

const createPaymentProviderPersistenceConflictError = (provider) => {
  return new AppError(
    "Payment provider session could not be linked safely",
    500,
    {
      errorCode: "PAYMENT_PROVIDER_SESSION_PERSISTENCE_CONFLICT",

      details: {
        provider,
      },
    },
  );
};

const createPaymentProviderSessionInitializingError = (provider) => {
  return new AppError(
    "Payment provider session is currently being initialized",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_SESSION_INITIALIZING",

      details: {
        provider,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Payment Confirmation Errors
|--------------------------------------------------------------------------
*/

const createPaymentTransactionNotFoundError = () => {
  return new AppError("Payment transaction was not found", 404, {
    errorCode: "PAYMENT_TRANSACTION_NOT_FOUND",
  });
};

const createPaymentConfirmationStateInvalidError = (status) => {
  return new AppError("Payment cannot be confirmed in its current state", 409, {
    errorCode: "PAYMENT_CONFIRMATION_STATE_INVALID",

    details: {
      status: status ?? null,
    },
  });
};

const createPaymentProviderOrderMissingError = () => {
  return new AppError("Payment provider Order reference is missing", 409, {
    errorCode: "PAYMENT_PROVIDER_ORDER_REFERENCE_MISSING",
  });
};

const createPaymentProviderOrderMismatchError = () => {
  return new AppError(
    "Payment provider Order does not match the Payment transaction",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_ORDER_MISMATCH",
    },
  );
};

const createPaymentProviderPaymentConflictError = () => {
  return new AppError(
    "Another provider Payment is already attached to this Payment transaction",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_PAYMENT_CONFLICT",
    },
  );
};

const createPaymentSignatureInvalidError = () => {
  return new AppError("Payment signature verification failed", 400, {
    errorCode: "PAYMENT_SIGNATURE_INVALID",
  });
};

const createPaymentConfirmationConflictError = () => {
  return new AppError(
    "Payment confirmation changed while it was being processed",
    409,
    {
      errorCode: "PAYMENT_CONFIRMATION_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Payment Provider State Synchronization Errors
|--------------------------------------------------------------------------
*/

const createPaymentProviderVerificationRequiredError = () => {
  return new AppError(
    "Payment confirmation must be verified before provider state can be synchronized",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_VERIFICATION_REQUIRED",
    },
  );
};

const createPaymentProviderPaymentMissingError = () => {
  return new AppError("Payment provider Payment reference is missing", 409, {
    errorCode: "PAYMENT_PROVIDER_PAYMENT_REFERENCE_MISSING",
  });
};

const createPaymentProviderSynchronizationStateInvalidError = (status) => {
  return new AppError(
    "Payment provider state cannot be synchronized in the current transaction state",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_SYNCHRONIZATION_STATE_INVALID",

      details: {
        status: status ?? null,
      },
    },
  );
};

const createPaymentProviderStateInvalidError = ({
  status,

  captured,
}) => {
  return new AppError(
    "Payment provider returned a state that cannot be applied to this Payment transaction",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_STATE_INVALID",

      details: {
        providerStatus: status ?? null,

        captured: captured ?? null,
      },
    },
  );
};

const createPaymentProviderSynchronizationConflictError = () => {
  return new AppError(
    "Payment provider state changed while synchronization was being processed",
    409,
    {
      errorCode: "PAYMENT_PROVIDER_SYNCHRONIZATION_CONFLICT",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Captured Payment Order Finalization Error
|--------------------------------------------------------------------------
*/

const createPaymentOrderFinalizationRequiresPaidError = (status) => {
  return new AppError(
    "Order finalization requires a fully paid Payment transaction",
    409,
    {
      errorCode: "PAYMENT_ORDER_FINALIZATION_REQUIRES_PAID",

      details: {
        paymentStatus: status ?? null,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Payment Provider State Rank
|--------------------------------------------------------------------------
|
| State synchronization must always move forward:
|
| pending
|    ↓
| authorized
|    ↓
| paid
|
| Never backwards.
|--------------------------------------------------------------------------
*/

const PAYMENT_TRANSACTION_PROVIDER_STATE_RANK = Object.freeze({
  [PAYMENT_TRANSACTION_STATUSES.PENDING]: 0,

  [PAYMENT_TRANSACTION_STATUSES.AUTHORIZED]: 1,

  [PAYMENT_TRANSACTION_STATUSES.PAID]: 2,
});

const getPaymentTransactionProviderStateRank = (status) => {
  return PAYMENT_TRANSACTION_PROVIDER_STATE_RANK[status] ?? null;
};

/*
|--------------------------------------------------------------------------
| Resolve Trusted Provider State
|--------------------------------------------------------------------------
|
| Converts provider-neutral Payment details from Part 189 into our local
| PaymentTransaction state.
|--------------------------------------------------------------------------
*/

const resolvePaymentProviderTargetStatus = ({
  status,

  captured,
}) => {
  const normalizedStatus = status.trim().toLowerCase();

  /*
  |--------------------------------------------------------------------------
  | Provider Payment Created
  |--------------------------------------------------------------------------
  */

  if (normalizedStatus === "created" && captured === false) {
    return PAYMENT_TRANSACTION_STATUSES.PENDING;
  }

  /*
  |--------------------------------------------------------------------------
  | Provider Payment Authorized
  |--------------------------------------------------------------------------
  */

  if (normalizedStatus === "authorized" && captured === false) {
    return PAYMENT_TRANSACTION_STATUSES.AUTHORIZED;
  }

  /*
  |--------------------------------------------------------------------------
  | Provider Payment Captured
  |--------------------------------------------------------------------------
  */

  if (normalizedStatus === "captured" && captured === true) {
    return PAYMENT_TRANSACTION_STATUSES.PAID;
  }

  /*
  |--------------------------------------------------------------------------
  | Fail Closed
  |--------------------------------------------------------------------------
  |
  | Examples:
  |
  | failed
  | refunded
  | captured + captured=false
  | authorized + captured=true
  |
  | These require separate lifecycle handling later.
  |--------------------------------------------------------------------------
  */

  throw createPaymentProviderStateInvalidError({
    status: normalizedStatus,

    captured,
  });
};

/*
|--------------------------------------------------------------------------
| Provider Session Single-Flight
|--------------------------------------------------------------------------
|
| Prevents concurrent requests inside this Node.js process from performing
| the same external provider initialization twice.
|
| MongoDB INITIALIZING state remains the cross-process safety boundary.
|--------------------------------------------------------------------------
*/

const paymentProviderSessionPromises = new Map();

/*
|--------------------------------------------------------------------------
| Build Payment Transaction Data
|--------------------------------------------------------------------------
|
| Everything except provider came from trusted Order state in Part 180.
|--------------------------------------------------------------------------
*/

const buildPaymentTransactionData = (
  plan,
  { paymentNumber, createdBy, initiatedAt },
) => {
  return {
    paymentNumber,

    order: plan.orderId,

    orderNumber: plan.orderNumber,

    customer: plan.customerId,

    provider: plan.provider,

    amount: plan.amount,

    currency: plan.currency,

    status: PAYMENT_TRANSACTION_STATUSES.CREATED,

    attemptNumber: plan.attemptNumber,

    initiatedAt,

    createdBy,
  };
};

/*
|--------------------------------------------------------------------------
| Resolve Concurrent Payment Attempt
|--------------------------------------------------------------------------
|
| Another request may have inserted the same:
|
| order + attemptNumber
|
| between:
|
| prepare()
|
| and
|
| create()
|--------------------------------------------------------------------------
*/

const resolveConcurrentPaymentAttempt = async ({
  order,
  provider,
  attemptNumber,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Read The Exact Winning Attempt
    |--------------------------------------------------------------------------
    */

  const existingPayment = await findPaymentTransactionByOrderAndAttemptNumber(
    order._id,

    attemptNumber,
  );

  if (!existingPayment) {
    throw createPaymentAttemptConflictError();
  }

  /*
    |--------------------------------------------------------------------------
    | Same Provider
    |--------------------------------------------------------------------------
    |
    | This is an idempotent concurrent duplicate.
    |--------------------------------------------------------------------------
    */

  if (existingPayment.provider === provider) {
    return {
      action: "reuse",

      paymentTransaction: existingPayment,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Different Provider
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | request A = Razorpay
    | request B = Stripe
    |
    | A wins attempt 1.
    |
    | B must not silently reuse Razorpay.
    |--------------------------------------------------------------------------
    */

  throw createActivePaymentProviderConflictError(
    existingPayment.provider,

    provider,
  );
};

/*
|--------------------------------------------------------------------------
| Create Local Payment Transaction
|--------------------------------------------------------------------------
|
| Handles extremely unlikely paymentNumber collisions.
|--------------------------------------------------------------------------
*/

const createLocalPaymentTransaction = async ({ plan, customerId }) => {
  for (
    let attempt = 1;
    attempt <= MAX_PAYMENT_NUMBER_CREATE_ATTEMPTS;
    attempt += 1
  ) {
    const paymentNumber = generatePaymentNumber();

    const initiatedAt = new Date();

    try {
      const paymentTransaction = await createPaymentTransactionDocument(
        buildPaymentTransactionData(plan, {
          paymentNumber,

          createdBy: customerId,

          initiatedAt,
        }),
      );

      return {
        action: "create",

        paymentTransaction: paymentTransaction.toObject(),
      };
    } catch (error) {
      /*
        |--------------------------------------------------------------------------
        | Payment Number Collision
        |--------------------------------------------------------------------------
        |
        | Very unlikely.
        |
        | Generate another number and retry.
        |--------------------------------------------------------------------------
        */

      if (isDuplicatePaymentNumberError(error)) {
        continue;
      }

      /*
        |--------------------------------------------------------------------------
        | Order + Attempt Collision
        |--------------------------------------------------------------------------
        |
        | Another request created the attempt first.
        |--------------------------------------------------------------------------
        */

      if (isDuplicateOrderAttemptError(error)) {
        return resolveConcurrentPaymentAttempt({
          order: {
            _id: plan.orderId,
          },

          provider: plan.provider,

          attemptNumber: plan.attemptNumber,
        });
      }

      throw error;
    }
  }

  throw createPaymentNumberGenerationError();
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

/*
|--------------------------------------------------------------------------
| Generate Payment Number
|--------------------------------------------------------------------------
|
| Format:
|
| PAY-YYYYMMDD-XXXXXXXXXXXX
|
| Example:
|
| PAY-20260811-A1B2C3D4E5F6
|--------------------------------------------------------------------------
*/

export const generatePaymentNumber = (date = new Date()) => {
  const year = date.getUTCFullYear().toString();

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  const day = String(date.getUTCDate()).padStart(2, "0");

  const randomPart = crypto
    .randomBytes(PAYMENT_NUMBER_RANDOM_BYTES)
    .toString("hex")
    .toUpperCase();

  return ["PAY", `${year}${month}${day}`, randomPart].join("-");
};

/*
|--------------------------------------------------------------------------
| Create Or Reuse Customer Online Payment
|--------------------------------------------------------------------------
|
| This is the main orchestration service for local PaymentTransaction
| creation.
|--------------------------------------------------------------------------
*/

export const createOrReuseCustomerOnlinePayment = async ({
  orderId,
  customerId,
  provider,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Build Trusted Plan / Check Existing Attempt
    |--------------------------------------------------------------------------
    */

  const preparation = await prepareCustomerOnlinePayment({
    orderId,

    customerId,

    provider,
  });

  /*
    |--------------------------------------------------------------------------
    | Existing Active Attempt
    |--------------------------------------------------------------------------
    */

  if (preparation.action === "reuse") {
    return {
      action: "reuse",

      paymentTransaction: preparation.paymentTransaction,

      plan: preparation.plan,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Create New Local Attempt
    |--------------------------------------------------------------------------
    */

  const result = await createLocalPaymentTransaction({
    plan: preparation.plan,

    customerId,
  });

  return {
    action: result.action,

    paymentTransaction: result.paymentTransaction,

    plan: preparation.plan,
  };
};

/*
|--------------------------------------------------------------------------
| Create And Persist Payment Provider Session
|--------------------------------------------------------------------------
*/

export const createAndPersistPaymentProviderSession = async ({
  paymentTransaction,
}) => {
  if (!paymentTransaction?._id) {
    throw new Error(
      "Payment transaction is required to create provider session",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Atomically Claim Initialization
    |--------------------------------------------------------------------------
    */

  const claimedPaymentTransaction =
    await claimPaymentTransactionForProviderSession(
      paymentTransaction._id,

      {
        provider: paymentTransaction.provider,
      },
    );

  /*
    |--------------------------------------------------------------------------
    | Another Request Already Claimed It
    |--------------------------------------------------------------------------
    */

  if (!claimedPaymentTransaction) {
    const currentPaymentTransaction = await findPaymentTransactionById(
      paymentTransaction._id,
    );

    if (
      currentPaymentTransaction?.status ===
        PAYMENT_TRANSACTION_STATUSES.PENDING &&
      currentPaymentTransaction?.providerReference?.orderId
    ) {
      const checkout = buildPaymentProviderCheckoutData({
        provider: currentPaymentTransaction.provider,

        providerOrderId: currentPaymentTransaction.providerReference.orderId,

        amount: currentPaymentTransaction.amount,

        currency: currentPaymentTransaction.currency,
      });

      return {
        paymentTransaction: currentPaymentTransaction,

        providerSession: {
          provider: currentPaymentTransaction.provider,

          providerOrderId: currentPaymentTransaction.providerReference.orderId,

          amount: currentPaymentTransaction.amount,

          currency: currentPaymentTransaction.currency,

          checkout,
        },
      };
    }

    if (
      currentPaymentTransaction?.status ===
      PAYMENT_TRANSACTION_STATUSES.INITIALIZING
    ) {
      throw createPaymentProviderSessionInitializingError(
        paymentTransaction.provider,
      );
    }

    throw createPaymentProviderPersistenceConflictError(
      paymentTransaction.provider,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Create External Provider Order
    |--------------------------------------------------------------------------
    */

  let providerSession;

  try {
    providerSession = await createPaymentProviderSession({
      provider: claimedPaymentTransaction.provider,

      paymentNumber: claimedPaymentTransaction.paymentNumber,

      orderNumber: claimedPaymentTransaction.orderNumber,

      amount: claimedPaymentTransaction.amount,

      currency: claimedPaymentTransaction.currency,

      customerId: claimedPaymentTransaction.customer,
    });
  } catch (error) {
    await markPaymentProviderSessionCreationFailed(
      claimedPaymentTransaction._id,

      {
        code: error?.errorCode ?? "PAYMENT_PROVIDER_SESSION_CREATION_FAILED",

        message: "Payment provider session could not be created",

        source: claimedPaymentTransaction.provider,

        step: "create-payment-session",

        reason: null,
      },
    );

    if (error?.isOperational === true) {
      throw error;
    }

    throw createPaymentProviderSessionFailedError(
      claimedPaymentTransaction.provider,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Persist Provider Order ID
    |--------------------------------------------------------------------------
    */

  const updatedPaymentTransaction =
    await attachPaymentProviderOrderToTransaction(
      claimedPaymentTransaction._id,

      {
        provider: claimedPaymentTransaction.provider,

        providerOrderId: providerSession.providerOrderId,
      },
    );

  /*
    |--------------------------------------------------------------------------
    | Important Safety Rule
    |--------------------------------------------------------------------------
    |
    | Provider Order already exists here.
    |
    | Do NOT mark the transaction failed if our persistence unexpectedly
    | loses its expected-state update.
    |--------------------------------------------------------------------------
    */

  if (!updatedPaymentTransaction) {
    throw createPaymentProviderPersistenceConflictError(
      claimedPaymentTransaction.provider,
    );
  }

  return {
    paymentTransaction: updatedPaymentTransaction,

    providerSession,
  };
};

/*
|--------------------------------------------------------------------------
| Ensure Customer Payment Provider Session
|--------------------------------------------------------------------------
|
| Handles:
|
| created      -> initialize provider
| initializing -> share current in-process initialization
| pending      -> rebuild Checkout from persisted provider Order
|--------------------------------------------------------------------------
*/

export const ensureCustomerPaymentProviderSession = async ({
  paymentTransaction,
}) => {
  if (!paymentTransaction?._id) {
    throw new Error("Payment transaction is required");
  }

  /*
    |--------------------------------------------------------------------------
    | Existing Provider Order
    |--------------------------------------------------------------------------
    */

  if (
    paymentTransaction.status === PAYMENT_TRANSACTION_STATUSES.PENDING &&
    paymentTransaction.providerReference?.orderId
  ) {
    const checkout = buildPaymentProviderCheckoutData({
      provider: paymentTransaction.provider,

      providerOrderId: paymentTransaction.providerReference.orderId,

      amount: paymentTransaction.amount,

      currency: paymentTransaction.currency,
    });

    return {
      paymentTransaction,

      providerSession: {
        provider: paymentTransaction.provider,

        providerOrderId: paymentTransaction.providerReference.orderId,

        amount: paymentTransaction.amount,

        currency: paymentTransaction.currency,

        checkout,
      },
    };
  }

  const paymentTransactionId = String(paymentTransaction._id);

  /*
    |--------------------------------------------------------------------------
    | Same Node Process Already Initializing
    |--------------------------------------------------------------------------
    */

  const existingPromise =
    paymentProviderSessionPromises.get(paymentTransactionId);

  if (existingPromise) {
    return existingPromise;
  }

  /*
    |--------------------------------------------------------------------------
    | Another Server Instance Owns Initialization
    |--------------------------------------------------------------------------
    */

  if (paymentTransaction.status === PAYMENT_TRANSACTION_STATUSES.INITIALIZING) {
    throw createPaymentProviderSessionInitializingError(
      paymentTransaction.provider,
    );
  }

  if (paymentTransaction.status !== PAYMENT_TRANSACTION_STATUSES.CREATED) {
    throw new Error(
      "Payment transaction is not eligible for provider initialization",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Start Single Provider Initialization
    |--------------------------------------------------------------------------
    */

  const initializationPromise = createAndPersistPaymentProviderSession({
    paymentTransaction,
  });

  paymentProviderSessionPromises.set(
    paymentTransactionId,

    initializationPromise,
  );

  try {
    return await initializationPromise;
  } finally {
    paymentProviderSessionPromises.delete(paymentTransactionId);
  }
};

/*
|--------------------------------------------------------------------------
| Initiate Customer Online Payment
|--------------------------------------------------------------------------
|
| Complete API orchestration:
|
| local PaymentTransaction
| +
| provider session
|--------------------------------------------------------------------------
*/

export const initiateCustomerOnlinePayment = async ({
  orderId,

  customerId,

  provider,
}) => {
  const localResult = await createOrReuseCustomerOnlinePayment({
    orderId,

    customerId,

    provider,
  });

  const providerResult = await ensureCustomerPaymentProviderSession({
    paymentTransaction: localResult.paymentTransaction,
  });

  return {
    action: localResult.action,

    paymentTransaction: providerResult.paymentTransaction,

    checkout: providerResult.providerSession.checkout,
  };
};

/*
|--------------------------------------------------------------------------
| Confirm Customer Razorpay Payment
|--------------------------------------------------------------------------
|
| This step verifies Checkout authenticity only.
|
| It DOES NOT:
|
| - mark PaymentTransaction paid
| - mark Order paid
| - confirm Order
| - commit inventory
|--------------------------------------------------------------------------
*/

export const confirmCustomerRazorpayPayment = async ({
  orderId,

  paymentTransactionId,

  customerId,

  razorpayOrderId,

  razorpayPaymentId,

  razorpaySignature,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Load Owned Payment
    |--------------------------------------------------------------------------
    */

  const paymentTransaction =
    await findCustomerPaymentTransactionForConfirmation(
      paymentTransactionId,

      orderId,

      customerId,
    );

  if (!paymentTransaction) {
    throw createPaymentTransactionNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Stored Provider Order Required
    |--------------------------------------------------------------------------
    */

  const storedProviderOrderId = paymentTransaction.providerReference?.orderId;

  if (!storedProviderOrderId) {
    throw createPaymentProviderOrderMissingError();
  }

  /*
    |--------------------------------------------------------------------------
    | Never Trust Browser Order ID
    |--------------------------------------------------------------------------
    |
    | The browser value may be used only as a consistency check.
    |
    | Signature generation below uses storedProviderOrderId from MongoDB.
    |--------------------------------------------------------------------------
    */

  if (razorpayOrderId !== storedProviderOrderId) {
    throw createPaymentProviderOrderMismatchError();
  }

  /*
    |--------------------------------------------------------------------------
    | Idempotent Retry
    |--------------------------------------------------------------------------
    */

  if (
    paymentTransaction.verifiedAt &&
    paymentTransaction.providerReference?.paymentId
  ) {
    if (paymentTransaction.providerReference.paymentId !== razorpayPaymentId) {
      throw createPaymentProviderPaymentConflictError();
    }

    return {
      action: "reuse",

      paymentTransaction,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Confirmation State
    |--------------------------------------------------------------------------
    */

  if (paymentTransaction.status !== PAYMENT_TRANSACTION_STATUSES.PENDING) {
    throw createPaymentConfirmationStateInvalidError(paymentTransaction.status);
  }

  /*
    |--------------------------------------------------------------------------
    | Server-Side Signature Verification
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    |
    | storedProviderOrderId
    |
    | NOT:
    |
    | razorpayOrderId supplied by the frontend.
    |--------------------------------------------------------------------------
    */

  const verified = verifyPaymentProviderConfirmation({
    provider: paymentTransaction.provider,

    providerOrderId: storedProviderOrderId,

    providerPaymentId: razorpayPaymentId,

    signature: razorpaySignature,
  });

  if (!verified) {
    throw createPaymentSignatureInvalidError();
  }

  /*
    |--------------------------------------------------------------------------
    | Persist Verified Confirmation
    |--------------------------------------------------------------------------
    */

  const verifiedAt = new Date();

  const updatedPaymentTransaction =
    await recordVerifiedPaymentProviderConfirmation(
      paymentTransaction._id,

      {
        orderId,

        customerId,

        provider: paymentTransaction.provider,

        providerOrderId: storedProviderOrderId,

        providerPaymentId: razorpayPaymentId,

        signature: razorpaySignature,

        verifiedAt,
      },
    );

  if (updatedPaymentTransaction) {
    return {
      action: "verify",

      paymentTransaction: updatedPaymentTransaction,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Concurrent Retry Resolution
    |--------------------------------------------------------------------------
    */

  const currentPaymentTransaction =
    await findCustomerPaymentTransactionForConfirmation(
      paymentTransactionId,

      orderId,

      customerId,
    );

  if (
    currentPaymentTransaction?.verifiedAt &&
    currentPaymentTransaction?.providerReference?.paymentId ===
      razorpayPaymentId
  ) {
    return {
      action: "reuse",

      paymentTransaction: currentPaymentTransaction,
    };
  }

  throw createPaymentConfirmationConflictError();
};

/*
|--------------------------------------------------------------------------
| Synchronize Customer Payment Provider State
|--------------------------------------------------------------------------
|
| Part 190:
|
| verified Razorpay Payment
|       ↓
| fetch provider Payment
|       ↓
| verify:
|   payment ID
|   order ID
|   amount
|   currency
|       ↓
| interpret trusted provider state
|       ↓
| update PaymentTransaction only
|
| IMPORTANT:
|
| This function DOES NOT:
|
| - mark Order.payment paid
| - confirm the Order
| - commit inventory
| - reduce reservedStock
|--------------------------------------------------------------------------
*/

export const synchronizeCustomerPaymentProviderState = async ({
  orderId,

  paymentTransactionId,

  customerId,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Load Customer-Owned Transaction
    |--------------------------------------------------------------------------
    */

  const paymentTransaction =
    await findCustomerPaymentTransactionForConfirmation(
      paymentTransactionId,

      orderId,

      customerId,
    );

  if (!paymentTransaction) {
    throw createPaymentTransactionNotFoundError();
  }

  /*
    |--------------------------------------------------------------------------
    | Checkout Verification Required
    |--------------------------------------------------------------------------
    */

  if (!paymentTransaction.verifiedAt) {
    throw createPaymentProviderVerificationRequiredError();
  }

  /*
    |--------------------------------------------------------------------------
    | Trusted Provider References
    |--------------------------------------------------------------------------
    */

  const providerOrderId = paymentTransaction.providerReference?.orderId;

  if (!providerOrderId) {
    throw createPaymentProviderOrderMissingError();
  }

  const providerPaymentId = paymentTransaction.providerReference?.paymentId;

  if (!providerPaymentId) {
    throw createPaymentProviderPaymentMissingError();
  }

  /*
    |--------------------------------------------------------------------------
    | Current Local State
    |--------------------------------------------------------------------------
    |
    | Only these states participate in Part 190:
    |
    | pending
    | authorized
    | paid
    |--------------------------------------------------------------------------
    */

  const currentStateRank = getPaymentTransactionProviderStateRank(
    paymentTransaction.status,
  );

  if (currentStateRank === null) {
    throw createPaymentProviderSynchronizationStateInvalidError(
      paymentTransaction.status,
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Fetch Trusted Provider Payment
    |--------------------------------------------------------------------------
    |
    | Part 189 verifies:
    |
    | providerPaymentId
    | providerOrderId
    | amount
    | currency
    |--------------------------------------------------------------------------
    */

  const providerPayment = await fetchAndVerifyPaymentProviderDetails({
    provider: paymentTransaction.provider,

    providerPaymentId,

    providerOrderId,

    amount: paymentTransaction.amount,

    currency: paymentTransaction.currency,
  });

  /*
    |--------------------------------------------------------------------------
    | Resolve Local Target State
    |--------------------------------------------------------------------------
    */

  const targetStatus = resolvePaymentProviderTargetStatus(providerPayment);

  const targetStateRank = getPaymentTransactionProviderStateRank(targetStatus);

  /*
    |--------------------------------------------------------------------------
    | Never Downgrade
    |--------------------------------------------------------------------------
    |
    | Examples:
    |
    | paid + provider says authorized
    | => stay paid
    |
    | authorized + provider says created
    | => stay authorized
    |--------------------------------------------------------------------------
    */

  if (currentStateRank >= targetStateRank) {
    return {
      action:
        currentStateRank === targetStateRank &&
        targetStatus === PAYMENT_TRANSACTION_STATUSES.PENDING
          ? "pending"
          : "reuse",

      providerPayment,

      paymentTransaction,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Local Observation Time
    |--------------------------------------------------------------------------
    |
    | This is when OUR backend observed the trusted state.
    |--------------------------------------------------------------------------
    */

  const observedAt = new Date();

  let updatedPaymentTransaction = null;

  /*
    |--------------------------------------------------------------------------
    | pending → authorized
    |--------------------------------------------------------------------------
    */

  if (targetStatus === PAYMENT_TRANSACTION_STATUSES.AUTHORIZED) {
    updatedPaymentTransaction = await markVerifiedPaymentTransactionAuthorized(
      paymentTransaction._id,

      {
        orderId,

        customerId,

        provider: paymentTransaction.provider,

        providerOrderId,

        providerPaymentId,

        authorizedAt: observedAt,
      },
    );
  }

  /*
    |--------------------------------------------------------------------------
    | pending / authorized → paid
    |--------------------------------------------------------------------------
    */

  if (targetStatus === PAYMENT_TRANSACTION_STATUSES.PAID) {
    updatedPaymentTransaction = await markVerifiedPaymentTransactionPaid(
      paymentTransaction._id,

      {
        orderId,

        customerId,

        provider: paymentTransaction.provider,

        providerOrderId,

        providerPaymentId,

        paidAt: observedAt,
      },
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Successful Atomic Transition
    |--------------------------------------------------------------------------
    */

  if (updatedPaymentTransaction) {
    return {
      action:
        targetStatus === PAYMENT_TRANSACTION_STATUSES.AUTHORIZED
          ? "authorize"
          : "pay",

      providerPayment,

      paymentTransaction: updatedPaymentTransaction,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Concurrent Request Resolution
    |--------------------------------------------------------------------------
    |
    | Another request may have already moved:
    |
    | pending → authorized
    |
    | or:
    |
    | pending/authorized → paid
    |--------------------------------------------------------------------------
    */

  const currentPaymentTransaction =
    await findCustomerPaymentTransactionForConfirmation(
      paymentTransactionId,

      orderId,

      customerId,
    );

  const synchronizedStateRank = getPaymentTransactionProviderStateRank(
    currentPaymentTransaction?.status,
  );

  if (
    currentPaymentTransaction &&
    synchronizedStateRank !== null &&
    synchronizedStateRank >= targetStateRank
  ) {
    return {
      action: "reuse",

      providerPayment,

      paymentTransaction: currentPaymentTransaction,
    };
  }

  throw createPaymentProviderSynchronizationConflictError();
};

/*
|--------------------------------------------------------------------------
| Finalize Captured Customer Online Order
|--------------------------------------------------------------------------
|
| Part 191 starts only after Part 190 has synchronized:
|
| PaymentTransaction.status = paid
|
| This function atomically applies that trusted payment to the Order.
|--------------------------------------------------------------------------
*/

export const finalizeCapturedCustomerOnlineOrder = async ({
  orderId,

  paymentTransactionId,

  customerId,
}) => {
  if (!customerId) {
    throw new Error("Customer ID is required to finalize an online Order");
  }

  const session = await mongoose.startSession();

  try {
    let finalizationResult;

    await session.withTransaction(
      async () => {
        /*
          |--------------------------------------------------------------------------
          | Reload PaymentTransaction Inside Transaction
          |--------------------------------------------------------------------------
          */

        const paymentTransaction =
          await findCustomerPaymentTransactionForConfirmation(
            paymentTransactionId,

            orderId,

            customerId,

            {
              session,
            },
          );

        if (!paymentTransaction) {
          throw createPaymentTransactionNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Part 190 Must Have Reached Paid
          |--------------------------------------------------------------------------
          */

        if (
          paymentTransaction.status !== PAYMENT_TRANSACTION_STATUSES.PAID ||
          !paymentTransaction.verifiedAt ||
          !paymentTransaction.paidAt
        ) {
          throw createPaymentOrderFinalizationRequiresPaidError(
            paymentTransaction.status,
          );
        }

        /*
          |--------------------------------------------------------------------------
          | Load Customer Order As Mongoose Document
          |--------------------------------------------------------------------------
          */

        const order = await findCustomerOrderForOnlinePaymentFinalization(
          orderId,

          customerId,

          {
            session,
          },
        );

        if (!order) {
          throw createOnlinePaymentOrderNotFoundError();
        }

        /*
          |--------------------------------------------------------------------------
          | Atomic Order + Inventory Finalization
          |--------------------------------------------------------------------------
          */

        const orderFinalization = await finalizePaidOnlineOrderInTransaction(
          order,

          {
            paymentTransaction,

            actorUserId: customerId,

            session,
          },
        );

        finalizationResult = {
          action: orderFinalization.action,

          paymentTransaction,

          order: orderFinalization.order,
        };
      },

      {
        readConcern: {
          level: "snapshot",
        },

        writeConcern: {
          w: "majority",
        },

        readPreference: "primary",
      },
    );

    return finalizationResult;
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| Process Customer Razorpay Payment Confirmation
|--------------------------------------------------------------------------
|
| Part 192 connects:
|
| Part 188
| Signature verification
|
| Part 189
| Trusted provider Payment lookup
|
| Part 190
| Local PaymentTransaction synchronization
|
| Part 191
| Captured Order finalization
|--------------------------------------------------------------------------
*/

export const processCustomerRazorpayPaymentConfirmation = async ({
  orderId,

  paymentTransactionId,

  customerId,

  razorpayOrderId,

  razorpayPaymentId,

  razorpaySignature,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Part 188 — Verify Checkout Signature
    |--------------------------------------------------------------------------
    */

  const confirmation = await confirmCustomerRazorpayPayment({
    orderId,

    paymentTransactionId,

    customerId,

    razorpayOrderId,

    razorpayPaymentId,

    razorpaySignature,
  });

  /*
    |--------------------------------------------------------------------------
    | Parts 189 + 190
    |--------------------------------------------------------------------------
    |
    | Fetch the Payment directly from Razorpay,
    | verify trusted IDs/amount/currency,
    | then synchronize our PaymentTransaction.
    |--------------------------------------------------------------------------
    */

  const synchronization = await synchronizeCustomerPaymentProviderState({
    orderId,

    paymentTransactionId,

    customerId,
  });

  /*
    |--------------------------------------------------------------------------
    | Part 191 — Finalize Only Paid Payments
    |--------------------------------------------------------------------------
    */

  let finalization = null;

  if (
    synchronization.paymentTransaction.status ===
    PAYMENT_TRANSACTION_STATUSES.PAID
  ) {
    finalization = await finalizeCapturedCustomerOnlineOrder({
      orderId,

      paymentTransactionId,

      customerId,
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Unified Result
    |--------------------------------------------------------------------------
    */

  return {
    confirmationAction: confirmation.action,

    synchronizationAction: synchronization.action,

    finalizationAction: finalization?.action ?? null,

    providerPayment: synchronization.providerPayment,

    paymentTransaction:
      finalization?.paymentTransaction ?? synchronization.paymentTransaction,

    order: finalization?.order ?? null,
  };
};
