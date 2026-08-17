import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  getAdminPaymentWebhookEventController,
  getAdminPaymentWebhookEventsController,
  requeueAdminPaymentWebhookEventController,
} from "./payment-webhook.admin.controller.js";

import {
  adminPaymentWebhookDetailsRequestSchema,
  adminPaymentWebhookListRequestSchema,
  adminPaymentWebhookRequeueRequestSchema,
} from "./payment-webhook.admin.validation.js";

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
| List Webhook Events
|--------------------------------------------------------------------------
*/

router.get(
  "/",

  validateRequest(adminPaymentWebhookListRequestSchema),

  getAdminPaymentWebhookEventsController,
);

/*
|--------------------------------------------------------------------------
| Requeue Dead-Lettered Event
|--------------------------------------------------------------------------
|
| Keep before /:webhookEventId for readability.
|--------------------------------------------------------------------------
*/

router.post(
  "/:webhookEventId/requeue",

  validateRequest(adminPaymentWebhookRequeueRequestSchema),

  requeueAdminPaymentWebhookEventController,
);

/*
|--------------------------------------------------------------------------
| Webhook Event Details
|--------------------------------------------------------------------------
*/

router.get(
  "/:webhookEventId",

  validateRequest(adminPaymentWebhookDetailsRequestSchema),

  getAdminPaymentWebhookEventController,
);

export default router;
