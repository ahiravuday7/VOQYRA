import { mapAdminOrderReturnReplacement } from "./order-return-replacement.mapper.js";

import {
  createAdminOrderReturnReplacement,
  processAdminOrderReturnReplacement,
  shipAdminOrderReturnReplacement,
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
