import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  processAdminReturnReplacementController,
  shipAdminReturnReplacementController,
  deliverAdminReturnReplacementController,
} from "./order-return-replacement.controller.js";

import {
  processOrderReturnReplacementRequestSchema,
  shipOrderReturnReplacementRequestSchema,
  deliverOrderReturnReplacementRequestSchema,
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

export default router;
