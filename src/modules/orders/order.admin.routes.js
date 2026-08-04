import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  getAdminOrdersController,
  getAdminOrderController,
  updateAdminOrderStatusController,
} from "./order.controller.js";

import {
  adminOrderListRequestSchema,
  adminOrderDetailsRequestSchema,
  adminOrderStatusUpdateRequestSchema,
} from "./order.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect Admin Order Routes
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| Get Admin Order Details
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/orders/:orderId
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(adminOrderListRequestSchema),
  getAdminOrdersController,
);

/*
|--------------------------------------------------------------------------
| Update Admin Order Status
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/orders/:orderId/status
|--------------------------------------------------------------------------
*/

router.patch(
  "/:orderId/status",
  validateRequest(adminOrderStatusUpdateRequestSchema),
  updateAdminOrderStatusController,
);

/*
|--------------------------------------------------------------------------
| Get Admin Order Details
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/orders/:orderId
|--------------------------------------------------------------------------
*/

router.get(
  "/:orderId",
  validateRequest(adminOrderDetailsRequestSchema),
  getAdminOrderController,
);
export default router;
