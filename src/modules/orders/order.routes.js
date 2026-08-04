import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createCustomerOrderController,
  getCustomerOrderController,
  getCustomerOrdersController,
  cancelCustomerOrderController,
} from "./order.controller.js";

import {
  createOrderRequestSchema,
  customerOrderDetailsRequestSchema,
  customerOrderListRequestSchema,
  cancelCustomerOrderRequestSchema,
} from "./order.validation.js";

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
| List Customer Orders
|--------------------------------------------------------------------------
|
| GET /api/v1/orders
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(customerOrderListRequestSchema),
  getCustomerOrdersController,
);

/*
|--------------------------------------------------------------------------
| Cancel Customer Order
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/:orderId/cancel
|--------------------------------------------------------------------------
*/

router.post(
  "/:orderId/cancel",
  validateRequest(cancelCustomerOrderRequestSchema),
  cancelCustomerOrderController,
);

/*
|--------------------------------------------------------------------------
| Get Customer Order Details
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/:orderId
|--------------------------------------------------------------------------
*/

router.get(
  "/:orderId",
  validateRequest(customerOrderDetailsRequestSchema),
  getCustomerOrderController,
);
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
