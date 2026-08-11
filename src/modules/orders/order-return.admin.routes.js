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
  markAdminOrderReturnRequestInTransitController,
  receiveAdminOrderReturnRequestController,
  inspectAdminOrderReturnRequestController,
  completeAdminOrderReturnRequestController,
  refundAdminOrderReturnRequestController,
  getAdminOrderReturnMetricsController,
} from "./order-return.controller.js";

import { createAdminReturnReplacementController } from "./order-return-replacement.controller.js";
import { createOrderReturnReplacementRequestSchema } from "./order-return-replacement.validation.js";

import {
  adminOrderReturnDetailsRequestSchema,
  adminOrderReturnListRequestSchema,
  adminOrderReturnApprovalRequestSchema,
  adminOrderReturnRejectionRequestSchema,
  adminOrderReturnMarkInTransitRequestSchema,
  adminOrderReturnReceiptRequestSchema,
  adminOrderReturnInspectionRequestSchema,
  adminOrderReturnCompletionRequestSchema,
  adminOrderReturnRefundRequestSchema,
  adminOrderReturnMetricsRequestSchema,
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
| Admin Return Operational Metrics
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/order-returns/metrics
|--------------------------------------------------------------------------
*/

router.get(
  "/metrics",

  validateRequest(adminOrderReturnMetricsRequestSchema),

  getAdminOrderReturnMetricsController,
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
| Mark Return Request In Transit
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/mark-in-transit",
  validateRequest(adminOrderReturnMarkInTransitRequestSchema),
  markAdminOrderReturnRequestInTransitController,
);

/*
|--------------------------------------------------------------------------
| Receive Return Request
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/receive",
  validateRequest(adminOrderReturnReceiptRequestSchema),
  receiveAdminOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Inspect Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/inspect
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/inspect",
  validateRequest(adminOrderReturnInspectionRequestSchema),
  inspectAdminOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Complete Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/complete
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/complete",
  validateRequest(adminOrderReturnCompletionRequestSchema),
  completeAdminOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Refund Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/refund
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/refund",
  validateRequest(adminOrderReturnRefundRequestSchema),
  refundAdminOrderReturnRequestController,
);

/*
|--------------------------------------------------------------------------
| Create Return Replacement
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/replacement
|--------------------------------------------------------------------------
*/

router.post(
  "/:returnRequestId/replacement",
  validateRequest(createOrderReturnReplacementRequestSchema),
  createAdminReturnReplacementController,
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
