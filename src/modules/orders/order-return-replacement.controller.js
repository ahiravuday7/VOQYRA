import {
  mapAdminOrderReturnReplacement,
  mapAdminOrderReturnReplacementSummary,
} from "./order-return-replacement.mapper.js";

import {
  createAdminOrderReturnReplacement,
  processAdminOrderReturnReplacement,
  shipAdminOrderReturnReplacement,
  deliverAdminOrderReturnReplacement,
  cancelAdminOrderReturnReplacement,
  failAdminOrderReturnReplacement,
  getAdminOrderReturnReplacementById,
  getAdminOrderReturnReplacements,
} from "./order-return-replacement.service.js";

/*
|--------------------------------------------------------------------------
| Create Admin Return Replacement
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/replacement
|--------------------------------------------------------------------------
*/

export const createAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { returnRequestId } = request.validated.params;

  const adminId = request.user._id;

  const replacement = await createAdminOrderReturnReplacement(
    returnRequestId,
    adminId,
  );

  return response.status(201).json({
    success: true,

    message: "Return replacement created and inventory reserved successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Process Admin Return Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/process
|--------------------------------------------------------------------------
*/

export const processAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { replacementId } = request.validated.params;

  const adminId = request.user._id;

  const processingData = request.validated.body;

  const replacement = await processAdminOrderReturnReplacement(
    replacementId,
    adminId,
    processingData,
  );

  return response.status(200).json({
    success: true,

    message: "Return replacement processing started successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Ship Admin Return Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/ship
|--------------------------------------------------------------------------
*/

export const shipAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { replacementId } = request.validated.params;

  const shipmentData = request.validated.body;

  const adminId = request.user._id;

  const replacement = await shipAdminOrderReturnReplacement(
    replacementId,
    adminId,
    shipmentData,
  );

  return response.status(200).json({
    success: true,

    message: "Return replacement shipped successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Deliver Admin Return Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/deliver
|--------------------------------------------------------------------------
*/

export const deliverAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { replacementId } = request.validated.params;

  const adminId = request.user._id;

  const replacement = await deliverAdminOrderReturnReplacement(
    replacementId,
    adminId,
  );

  return response.status(200).json({
    success: true,

    message: "Return replacement delivered successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Cancel Admin Return Replacement
|--------------------------------------------------------------------------
*/

export const cancelAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { replacementId } = request.validated.params;

  const cancellationData = request.validated.body;

  const adminId = request.user._id;

  const replacement = await cancelAdminOrderReturnReplacement(
    replacementId,
    adminId,
    cancellationData,
  );

  return response.status(200).json({
    success: true,

    message: "Return replacement cancelled successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Fail Admin Return Replacement
|--------------------------------------------------------------------------
*/

export const failAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { replacementId } = request.validated.params;

  const failureData = request.validated.body;

  const adminId = request.user._id;

  const replacement = await failAdminOrderReturnReplacement(
    replacementId,
    adminId,
    failureData,
  );

  return response.status(200).json({
    success: true,

    message: "Return replacement marked as failed successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Return Replacements
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/order-return-replacements
|--------------------------------------------------------------------------
*/

export const getAdminReturnReplacementsController = async (
  request,
  response,
) => {
  const filters = request.validated.query;

  const { replacements, pagination } =
    await getAdminOrderReturnReplacements(filters);

  const mappedReplacements = replacements.map(
    mapAdminOrderReturnReplacementSummary,
  );

  return response.status(200).json({
    success: true,

    message: "Admin Return replacements retrieved successfully",

    data: {
      replacements: mappedReplacements,

      pagination,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Return Replacement
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/order-return-replacements/:replacementId
|--------------------------------------------------------------------------
*/

export const getAdminReturnReplacementController = async (
  request,
  response,
) => {
  const { replacementId } = request.validated.params;

  const replacement = await getAdminOrderReturnReplacementById(replacementId);

  return response.status(200).json({
    success: true,

    message: "Admin Return replacement retrieved successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};
