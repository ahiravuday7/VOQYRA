import { mapAdminOrderReturnReplacement } from "./order-return-replacement.mapper.js";

import { createAdminOrderReturnReplacement } from "./order-return-replacement.service.js";

/*
|--------------------------------------------------------------------------
| Create Admin Return Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-returns/:returnRequestId/replacement
|--------------------------------------------------------------------------
*/

export const createAdminReturnReplacementController = async (req, res) => {
  const replacement = await createAdminOrderReturnReplacement(
    req.params.returnRequestId,
    req.user._id,
  );

  return res.status(201).json({
    success: true,

    message: "Return replacement created and inventory reserved successfully",

    data: {
      replacement: mapAdminOrderReturnReplacement(replacement),
    },
  });
};
