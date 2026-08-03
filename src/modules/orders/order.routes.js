import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import { createCustomerOrderController } from "./order.controller.js";

import { createOrderRequestSchema } from "./order.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer Order Authentication
|--------------------------------------------------------------------------
|
| Every route registered below requires:
|
| - Valid authenticated user
| - Customer role
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.CUSTOMER));

/*
|--------------------------------------------------------------------------
| Create Customer Order
|--------------------------------------------------------------------------
|
| POST
| /api/v1/orders
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  validateRequest(createOrderRequestSchema),
  createCustomerOrderController,
);

export default router;
