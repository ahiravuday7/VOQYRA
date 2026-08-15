import { mapCustomerPaymentTransaction } from "./payment.mapper.js";

import {
  initiateCustomerOnlinePayment,
  confirmCustomerRazorpayPayment,
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

  const result = await confirmCustomerRazorpayPayment({
    orderId,

    paymentTransactionId,

    customerId,

    razorpayOrderId: razorpay_order_id,

    razorpayPaymentId: razorpay_payment_id,

    razorpaySignature: razorpay_signature,
  });

  const message =
    result.action === "verify"
      ? "Payment confirmation verified successfully"
      : "Payment confirmation already verified";

  return response.status(200).json({
    success: true,

    message,

    data: {
      action: result.action,

      verified: true,

      payment: mapCustomerPaymentTransaction(result.paymentTransaction),
    },
  });
};
