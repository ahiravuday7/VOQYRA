import { createCustomerOrderReturnRequest } from "./order.service.js";

import { toCustomerOrderReturnRequest } from "./order-return.mapper.js";

/*
|--------------------------------------------------------------------------
| Create Customer Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/:orderId/returns
|--------------------------------------------------------------------------
*/

export const createCustomerOrderReturnRequestController = async (
  request,
  response,
) => {
  const { orderId } = request.validated.params;

  const returnData = request.validated.body;

  const customerId = request.user._id;

  const returnRequest = await createCustomerOrderReturnRequest(
    orderId,
    customerId,
    returnData,
  );

  const mappedReturnRequest = toCustomerOrderReturnRequest(returnRequest);

  request.log?.info(
    {
      customerId: String(customerId),

      orderId: mappedReturnRequest.orderId,

      orderNumber: mappedReturnRequest.orderNumber,

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      requestedResolution: mappedReturnRequest.requestedResolution,

      itemCount: mappedReturnRequest.items.length,
    },
    "Customer Order return request created",
  );

  return response.status(201).json({
    success: true,

    message: "Return request created successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};
