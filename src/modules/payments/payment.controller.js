import { mapCustomerPaymentTransaction } from "./payment.mapper.js";

import { createOrReuseCustomerOnlinePayment } from "./payment.service.js";

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

  const result = await createOrReuseCustomerOnlinePayment({
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
    },
  });
};
