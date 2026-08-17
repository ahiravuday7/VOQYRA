import { toCustomerOrder } from "../orders/order.mapper.js";

import { PAYMENT_TRANSACTION_STATUSES } from "./payment.model.js";

import { mapCustomerPaymentTransaction } from "./payment.mapper.js";

import {
  initiateCustomerOnlinePayment,
  processCustomerRazorpayPaymentConfirmation,
} from "./payment.service.js";

/*
|--------------------------------------------------------------------------
| Create Or Reuse Customer Online Payment
|--------------------------------------------------------------------------
|
| POST
| /api/v1/orders/:orderId/payments
|--------------------------------------------------------------------------
*/

export const createCustomerOnlinePaymentController = async (
  request,
  response,
) => {
  const { orderId } = request.validated.params;

  const { provider } = request.validated.body;

  const customerId = request.user._id;

  const result = await initiateCustomerOnlinePayment({
    orderId,

    customerId,

    provider,
  });

  /*
    |--------------------------------------------------------------------------
    | HTTP Semantics
    |--------------------------------------------------------------------------
    |
    | create -> new resource       -> 201
    | reuse  -> existing resource  -> 200
    |--------------------------------------------------------------------------
    */

  const isCreated = result.action === "create";

  const statusCode = isCreated ? 201 : 200;

  const message = isCreated
    ? "Online Payment attempt created successfully"
    : "Active Online Payment attempt retrieved successfully";

  return response.status(statusCode).json({
    success: true,

    message,

    data: {
      action: result.action,

      payment: mapCustomerPaymentTransaction(result.paymentTransaction),

      checkout: result.checkout,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Confirm Customer Razorpay Payment
|--------------------------------------------------------------------------
|
| POST
|
| /api/v1/orders/:orderId/payments/:paymentTransactionId/confirm
|
| Part 192 complete workflow:
|
| signature
|    ↓
| provider verification
|    ↓
| PaymentTransaction synchronization
|    ↓
| captured Order finalization
|--------------------------------------------------------------------------
*/

export const confirmCustomerRazorpayPaymentController = async (
  request,

  response,
) => {
  const {
    orderId,

    paymentTransactionId,
  } = request.validated.params;

  const {
    razorpay_order_id,

    razorpay_payment_id,

    razorpay_signature,
  } = request.validated.body;

  const customerId = request.user._id;

  /*
    |--------------------------------------------------------------------------
    | Complete Payment Workflow
    |--------------------------------------------------------------------------
    */

  const result = await processCustomerRazorpayPaymentConfirmation({
    orderId,

    paymentTransactionId,

    customerId,

    razorpayOrderId: razorpay_order_id,

    razorpayPaymentId: razorpay_payment_id,

    razorpaySignature: razorpay_signature,
  });

  /*
    |--------------------------------------------------------------------------
    | Customer-Safe Payment
    |--------------------------------------------------------------------------
    */

  const mappedPayment = mapCustomerPaymentTransaction(
    result.paymentTransaction,
  );

  /*
    |--------------------------------------------------------------------------
    | Customer-Safe Order
    |--------------------------------------------------------------------------
    |
    | Null means the Payment is not captured yet.
    |--------------------------------------------------------------------------
    */

  const mappedOrder = result.order ? toCustomerOrder(result.order) : null;

  /*
    |--------------------------------------------------------------------------
    | Response Message
    |--------------------------------------------------------------------------
    */

  let message;

  if (result.finalizationAction === "finalize") {
    message = "Payment confirmed and Order finalized successfully";
  } else if (result.finalizationAction === "reuse") {
    message = "Payment confirmation and Order finalization already completed";
  } else if (mappedPayment.status === PAYMENT_TRANSACTION_STATUSES.AUTHORIZED) {
    message = "Payment confirmed and authorized; awaiting capture";
  } else {
    message =
      result.confirmationAction === "verify"
        ? "Payment confirmation verified; awaiting provider completion"
        : "Payment confirmation already verified; awaiting provider completion";
  }

  /*
    |--------------------------------------------------------------------------
    | Logging
    |--------------------------------------------------------------------------
    */

  request.log?.info(
    {
      orderId,

      paymentTransactionId,

      customerId: String(customerId),

      confirmationAction: result.confirmationAction,

      synchronizationAction: result.synchronizationAction,

      finalizationAction: result.finalizationAction,

      paymentStatus: mappedPayment.status,

      providerStatus: result.providerPayment?.status,

      captured: result.providerPayment?.captured,
    },

    "Customer Razorpay Payment confirmation processed",
  );

  /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    |
    | `action`, `verified`, and `payment`
    | are intentionally retained for Part 188 compatibility.
    |--------------------------------------------------------------------------
    */

  return response.status(200).json({
    success: true,

    message,

    data: {
      /*
       * Backward-compatible Part 188 field.
       *
       * verify | reuse
       */
      action: result.confirmationAction,

      verified: true,

      payment: mappedPayment,

      /*
          |--------------------------------------------------------------------------
          | Provider State
          |--------------------------------------------------------------------------
          */

      providerState: {
        action: result.synchronizationAction,

        status: result.providerPayment?.status ?? null,

        captured: result.providerPayment?.captured ?? false,

        method: result.providerPayment?.method ?? null,
      },

      /*
          |--------------------------------------------------------------------------
          | Order Finalization
          |--------------------------------------------------------------------------
          */

      orderFinalization: {
        action: result.finalizationAction,

        finalized: mappedOrder !== null,
      },

      order: mappedOrder,
    },
  });
};
