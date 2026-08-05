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
  customerOrderReturnRequestSchema,
  customerOrderReturnDetailsRequestSchema,
  customerOrderReturnListRequestSchema,
  customerOrderReturnCancellationRequestSchema,
} from "./order.validation.js";

import {
  createCustomerOrderReturnRequestController,
  getCustomerOrderReturnRequestController,
  getCustomerOrderReturnRequestsController,
  cancelCustomerOrderReturnRequestController,
} from "./order-return.controller.js";

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
| Customer Return Request History
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/returns
|--------------------------------------------------------------------------
*/

router.get(
  "/returns",
  validateRequest(customerOrderReturnListRequestSchema),
  getCustomerOrderReturnRequestsController,
);

/*
|--------------------------------------------------------------------------
| Cancel Customer Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/returns/:returnRequestId/cancel
|--------------------------------------------------------------------------
*/

router.post(
  "/returns/:returnRequestId/cancel",
  validateRequest(customerOrderReturnCancellationRequestSchema),
  cancelCustomerOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Customer Return Request Details
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/returns/:returnRequestId
|--------------------------------------------------------------------------
*/

router.get(
  "/returns/:returnRequestId",
  validateRequest(customerOrderReturnDetailsRequestSchema),
  getCustomerOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Create Customer Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/:orderId/returns
|--------------------------------------------------------------------------
*/

router.post(
  "/:orderId/returns",
  validateRequest(customerOrderReturnRequestSchema),
  createCustomerOrderReturnRequestController,
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

export default router;
