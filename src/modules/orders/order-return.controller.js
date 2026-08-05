import {
  createCustomerOrderReturnRequest,
  getCustomerOrderReturnRequestById,
  getCustomerOrderReturnRequests,
  cancelCustomerOrderReturnRequest,
  getAdminOrderReturnRequestById,
  getAdminOrderReturnRequests,
} from "./order.service.js";

import {
  toCustomerOrderReturnRequest,
  toCustomerOrderReturnRequestSummary,
  toAdminOrderReturnRequest,
  toAdminOrderReturnRequestSummary,
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

/*
|--------------------------------------------------------------------------
| Cancel Customer Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/returns/:returnRequestId/cancel
|--------------------------------------------------------------------------
*/

export const cancelCustomerOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const cancellationData = request.validated.body;

  const customerId = request.user._id;

  const cancelledReturnRequest = await cancelCustomerOrderReturnRequest(
    returnRequestId,
    customerId,
    cancellationData,
  );

  const mappedReturnRequest = toCustomerOrderReturnRequest(
    cancelledReturnRequest,
  );

  request.log?.info(
    {
      customerId: String(customerId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      orderId: mappedReturnRequest.orderId,

      status: mappedReturnRequest.status,

      cancelledAt: mappedReturnRequest.cancellation.cancelledAt,
    },
    "Customer Order return request cancelled",
  );

  return response.status(200).json({
    success: true,

    message: "Return request cancelled successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Order Return Requests
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/order-returns
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnRequestsController = async (
  request,
  response,
) => {
  const filters = request.validated.query;

  const { returnRequests, pagination } =
    await getAdminOrderReturnRequests(filters);

  const mappedReturnRequests = returnRequests.map(
    toAdminOrderReturnRequestSummary,
  );

  return response.status(200).json({
    success: true,

    message: "Admin Return Requests retrieved successfully",

    data: {
      returnRequests: mappedReturnRequests,

      pagination,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Order Return Request
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/order-returns/:returnRequestId
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const returnRequest = await getAdminOrderReturnRequestById(returnRequestId);

  const mappedReturnRequest = toAdminOrderReturnRequest(returnRequest);

  return response.status(200).json({
    success: true,

    message: "Admin Return Request retrieved successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};
