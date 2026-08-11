import {
  createCustomerOrderReturnRequest,
  getCustomerOrderReturnRequestById,
  getCustomerOrderReturnRequests,
  cancelCustomerOrderReturnRequest,
  getAdminOrderReturnRequestById,
  getAdminOrderReturnRequests,
  approveAdminOrderReturnRequest,
  markAdminOrderReturnRequestInTransit,
  rejectAdminOrderReturnRequest,
  receiveAdminOrderReturnRequest,
  inspectAdminOrderReturnRequest,
  completeAdminOrderReturnRequest,
  refundAdminOrderReturnRequest,
} from "./order.service.js";

import {
  toCustomerOrderReturnRequest,
  toCustomerOrderReturnRequestSummary,
  toAdminOrderReturnRequest,
  toAdminOrderReturnRequestSummary,
} from "./order-return.mapper.js";

import {
  getAdminOrderReturnReplacementSummaryByReturnRequest,
  getCustomerOrderReturnReplacementSummaryByReturnRequest,
} from "./order-return-replacement.service.js";

import {
  mapAdminOrderReturnReplacementSummary,
  mapCustomerOrderReturnReplacementSummary,
} from "./order-return-replacement.mapper.js";

import { getAdminOrderReturnOperationalMetrics } from "./order-return-metrics.service.js";

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
| GET
| /api/v1/orders/returns/:returnRequestId
|--------------------------------------------------------------------------
*/

export const getCustomerOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const customerId = request.user._id;

  /*
    |--------------------------------------------------------------------------
    | Load Owned Return First
    |--------------------------------------------------------------------------
    |
    | Do not query Replacement before ownership of the Return has been
    | established.
    |--------------------------------------------------------------------------
    */

  const returnRequest = await getCustomerOrderReturnRequestById(
    returnRequestId,
    customerId,
  );

  /*
    |--------------------------------------------------------------------------
    | Find Linked Replacement
    |--------------------------------------------------------------------------
    */

  const replacement =
    await getCustomerOrderReturnReplacementSummaryByReturnRequest(
      returnRequestId,
      customerId,
    );

  const mappedReturnRequest = toCustomerOrderReturnRequest(returnRequest);

  /*
    |--------------------------------------------------------------------------
    | Attach Customer-Safe Replacement Summary
    |--------------------------------------------------------------------------
    */

  mappedReturnRequest.replacement = replacement
    ? mapCustomerOrderReturnReplacementSummary(replacement)
    : null;

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
| GET
| /api/v1/admin/order-returns/:returnRequestId
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  /*
    |--------------------------------------------------------------------------
    | Load Return
    |--------------------------------------------------------------------------
    */

  const returnRequest = await getAdminOrderReturnRequestById(returnRequestId);

  /*
    |--------------------------------------------------------------------------
    | Load Linked Replacement
    |--------------------------------------------------------------------------
    */

  const replacement =
    await getAdminOrderReturnReplacementSummaryByReturnRequest(returnRequestId);

  const mappedReturnRequest = toAdminOrderReturnRequest(returnRequest);

  /*
    |--------------------------------------------------------------------------
    | Attach Admin Replacement Summary
    |--------------------------------------------------------------------------
    */

  mappedReturnRequest.replacement = replacement
    ? mapAdminOrderReturnReplacementSummary(replacement)
    : null;

  return response.status(200).json({
    success: true,

    message: "Admin Return Request retrieved successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Approve Admin Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/approve
|--------------------------------------------------------------------------
*/

export const approveAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const approvalData = request.validated.body;

  const adminId = request.user._id;

  const approvedReturnRequest = await approveAdminOrderReturnRequest(
    returnRequestId,
    adminId,
    approvalData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(approvedReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      orderId: mappedReturnRequest.orderId,

      status: mappedReturnRequest.status,

      approvedAt: mappedReturnRequest.approval.approvedAt,
    },
    "Admin approved Order Return Request",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request approved successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Reject Admin Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/reject
|--------------------------------------------------------------------------
*/

export const rejectAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const rejectionData = request.validated.body;

  const adminId = request.user._id;

  const rejectedReturnRequest = await rejectAdminOrderReturnRequest(
    returnRequestId,
    adminId,
    rejectionData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(rejectedReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      orderId: mappedReturnRequest.orderId,

      status: mappedReturnRequest.status,

      rejectedAt: mappedReturnRequest.rejection.rejectedAt,
    },
    "Admin rejected Order Return Request",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request rejected successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Mark Admin Return Request In Transit
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/mark-in-transit
|--------------------------------------------------------------------------
*/

export const markAdminOrderReturnRequestInTransitController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const shipmentData = request.validated.body;

  const adminId = request.user._id;

  const inTransitReturnRequest = await markAdminOrderReturnRequestInTransit(
    returnRequestId,
    adminId,
    shipmentData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(inTransitReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      status: mappedReturnRequest.status,

      carrier: mappedReturnRequest.shipment.carrier,

      trackingNumber: mappedReturnRequest.shipment.trackingNumber,

      markedInTransitAt: mappedReturnRequest.shipment.markedInTransitAt,
    },
    "Admin marked Order Return Request as in transit",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request marked as in transit successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Receive Admin Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/receive
|--------------------------------------------------------------------------
*/

export const receiveAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const receiptData = request.validated.body;

  const adminId = request.user._id;

  const receivedReturnRequest = await receiveAdminOrderReturnRequest(
    returnRequestId,
    adminId,
    receiptData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(receivedReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      status: mappedReturnRequest.status,

      receivedAt: mappedReturnRequest.receipt.receivedAt,
    },
    "Warehouse received Order Return Request",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request received successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Inspect Admin Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/inspect
|--------------------------------------------------------------------------
*/

export const inspectAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const inspectionData = request.validated.body;

  const adminId = request.user._id;

  const inspectedReturnRequest = await inspectAdminOrderReturnRequest(
    returnRequestId,
    adminId,
    inspectionData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(inspectedReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      status: mappedReturnRequest.status,

      inspectedItems: mappedReturnRequest.items.length,
    },
    "Warehouse inspected Order Return Request",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request inspected successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Complete Admin Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/complete
|--------------------------------------------------------------------------
*/

export const completeAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const completionData = request.validated.body;

  const adminId = request.user._id;

  const completedReturnRequest = await completeAdminOrderReturnRequest(
    returnRequestId,
    adminId,
    completionData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(completedReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      status: mappedReturnRequest.status,

      completedAt: mappedReturnRequest.completion.completedAt,
    },
    "Admin completed Order Return Request",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request completed successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Refund Admin Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/refund
|--------------------------------------------------------------------------
*/

export const refundAdminOrderReturnRequestController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const refundData = request.validated.body;

  const adminId = request.user._id;

  const refundedReturnRequest = await refundAdminOrderReturnRequest(
    returnRequestId,
    adminId,
    refundData,
  );

  const mappedReturnRequest = toAdminOrderReturnRequest(refundedReturnRequest);

  request.log?.info(
    {
      adminId: String(adminId),

      returnRequestId: mappedReturnRequest.id,

      returnRequestNumber: mappedReturnRequest.returnRequestNumber,

      status: mappedReturnRequest.status,

      refundAmount: mappedReturnRequest.refund.amount,

      refundedQuantity: mappedReturnRequest.refund.refundedQuantity,

      refundReferenceId: mappedReturnRequest.refund.referenceId,

      refundedAt: mappedReturnRequest.refund.refundedAt,
    },
    "Admin refunded Order Return Request",
  );

  return response.status(200).json({
    success: true,

    message: "Return Request refunded successfully",

    data: {
      returnRequest: mappedReturnRequest,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Return Operational Metrics
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/order-returns/metrics
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnMetricsController = async (
  request,
  response,
) => {
  const metrics = await getAdminOrderReturnOperationalMetrics();

  return response.status(200).json({
    success: true,

    message: "Admin Return operational metrics retrieved successfully",

    data: {
      metrics,
    },
  });
};
