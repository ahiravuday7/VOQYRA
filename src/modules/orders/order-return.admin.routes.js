import express from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  getAdminOrderReturnRequestController,
  getAdminOrderReturnRequestsController,
} from "./order-return.controller.js";

import {
  adminOrderReturnDetailsRequestSchema,
  adminOrderReturnListRequestSchema,
} from "./order.validation.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Admin Return Authentication and Authorization
|--------------------------------------------------------------------------
*/

router.use(authenticate);

router.use(authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| Admin Return Request List
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(adminOrderReturnListRequestSchema),
  getAdminOrderReturnRequestsController,
);

/*
|--------------------------------------------------------------------------
| Admin Return Request Details
|--------------------------------------------------------------------------
*/

router.get(
  "/:returnRequestId",
  validateRequest(adminOrderReturnDetailsRequestSchema),
  getAdminOrderReturnRequestController,
);

export default router;
