import express from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  getAdminOrderReturnRequestController,
  getAdminOrderReturnRequestsController,
  approveAdminOrderReturnRequestController,
  rejectAdminOrderReturnRequestController,
} from "./order-return.controller.js";

import {
  adminOrderReturnDetailsRequestSchema,
  adminOrderReturnListRequestSchema,
  adminOrderReturnApprovalRequestSchema,
  adminOrderReturnRejectionRequestSchema,
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
| Approve Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/approve
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/approve",
  validateRequest(adminOrderReturnApprovalRequestSchema),
  approveAdminOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Reject Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/reject
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/reject",
  validateRequest(adminOrderReturnRejectionRequestSchema),
  rejectAdminOrderReturnRequestController,
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
