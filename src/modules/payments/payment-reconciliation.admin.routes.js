import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import { getAdminPaymentReconciliationsController } from "./payment-reconciliation.admin.controller.js";

import { adminPaymentReconciliationListRequestSchema } from "./payment-reconciliation.admin.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Admin Protection
|--------------------------------------------------------------------------
*/

router.use(
  authenticate,

  authorizeRoles(USER_ROLES.ADMIN),
);

/*
|--------------------------------------------------------------------------
| List Payment Reconciliations
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/payment-reconciliations
|--------------------------------------------------------------------------
*/

router.get(
  "/",

  validateRequest(adminPaymentReconciliationListRequestSchema),

  getAdminPaymentReconciliationsController,
);

export default router;
