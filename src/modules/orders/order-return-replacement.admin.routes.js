import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  processAdminReturnReplacementController,
  shipAdminReturnReplacementController,
  deliverAdminReturnReplacementController,
  cancelAdminReturnReplacementController,
  failAdminReturnReplacementController,
  getAdminReturnReplacementController,
  getAdminReturnReplacementsController,
} from "./order-return-replacement.controller.js";

import {
  processOrderReturnReplacementRequestSchema,
  shipOrderReturnReplacementRequestSchema,
  deliverOrderReturnReplacementRequestSchema,
  cancelOrderReturnReplacementRequestSchema,
  failOrderReturnReplacementRequestSchema,
  adminOrderReturnReplacementDetailsRequestSchema,
  adminOrderReturnReplacementListRequestSchema,
} from "./order-return-replacement.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin Replacement Authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| Admin Replacement List
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/order-return-replacements
|--------------------------------------------------------------------------
*/

router.get(
  "/",

  validateRequest(adminOrderReturnReplacementListRequestSchema),

  getAdminReturnReplacementsController,
);

/*
|--------------------------------------------------------------------------
| Start Replacement Processing
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/process
|--------------------------------------------------------------------------
*/

router.post(
  "/:replacementId/process",

  validateRequest(processOrderReturnReplacementRequestSchema),

  processAdminReturnReplacementController,
);

/*
|--------------------------------------------------------------------------
| Ship Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/ship
|--------------------------------------------------------------------------
*/

router.post(
  "/:replacementId/ship",

  validateRequest(shipOrderReturnReplacementRequestSchema),

  shipAdminReturnReplacementController,
);

/*
|--------------------------------------------------------------------------
| Deliver Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/deliver
|--------------------------------------------------------------------------
*/

router.post(
  "/:replacementId/deliver",

  validateRequest(deliverOrderReturnReplacementRequestSchema),

  deliverAdminReturnReplacementController,
);

/*
|--------------------------------------------------------------------------
| Cancel Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/cancel
|--------------------------------------------------------------------------
*/

router.post(
  "/:replacementId/cancel",

  validateRequest(cancelOrderReturnReplacementRequestSchema),

  cancelAdminReturnReplacementController,
);

/*
|--------------------------------------------------------------------------
| Fail Replacement
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/fail
|--------------------------------------------------------------------------
*/

router.post(
  "/:replacementId/fail",

  validateRequest(failOrderReturnReplacementRequestSchema),

  failAdminReturnReplacementController,
);

/*
|--------------------------------------------------------------------------
| Admin Replacement Details
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/order-return-replacements/:replacementId
|--------------------------------------------------------------------------
*/

router.get(
  "/:replacementId",

  validateRequest(adminOrderReturnReplacementDetailsRequestSchema),

  getAdminReturnReplacementController,
);

export default router;
