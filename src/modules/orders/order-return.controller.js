import {
  createCustomerOrderReturnRequest,
  getCustomerOrderReturnRequestById,
  getCustomerOrderReturnRequests,
} from "./order.service.js";

import {
  toCustomerOrderReturnRequest,
  toCustomerOrderReturnRequestSummary,
} from "./order-return.mapper.js";

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

/*
|--------------------------------------------------------------------------
| Get Customer Order Return Requests
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/returns
|--------------------------------------------------------------------------
*/

export const getCustomerOrderReturnRequestsController = async (
  request,
  response,
) => {
  const customerId = request.user._id;

  const filters = request.validated.query;

  const { returnRequests, pagination } = await getCustomerOrderReturnRequests(
    customerId,
    filters,
  );

  const mappedReturnRequests = returnRequests.map(
    toCustomerOrderReturnRequestSummary,
  );

  return response.status(200).json({
    success: true,

    message: "Return requests retrieved successfully",

    data: {
      returnRequests: mappedReturnRequests,

      pagination,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Customer Order Return Request
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/returns/:returnRequestId
|--------------------------------------------------------------------------
*/

export const getCustomerOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const customerId = request.user._id;

  const returnRequest = await getCustomerOrderReturnRequestById(
    returnRequestId,
    customerId,
  );

  const mappedReturnRequest = toCustomerOrderReturnRequest(returnRequest);

  return response.status(200).json({
    success: true,

    message: "Return request retrieved successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};
