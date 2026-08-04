import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import { getAdminOrdersController } from "./order.controller.js";

import { adminOrderListRequestSchema } from "./order.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect Admin Order Routes
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| List Admin Orders
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/orders
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(adminOrderListRequestSchema),
  getAdminOrdersController,
);

export default router;
