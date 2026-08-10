import { mapAdminOrderReturnReplacement } from "./order-return-replacement.mapper.js";

import { createAdminOrderReturnReplacement } from "./order-return-replacement.service.js";

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
