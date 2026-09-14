import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  clearRecentlyViewedController,
  deleteRecentlyViewedItemController,
  getRecentlyViewedController,
  recordRecentlyViewedController,
} from "./recently-viewed.controller.js";

import {
  clearRecentlyViewedRequestSchema,
  deleteRecentlyViewedItemRequestSchema,
  getRecentlyViewedRequestSchema,
  recordRecentlyViewedRequestSchema,
} from "./recently-viewed.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer Authentication
|--------------------------------------------------------------------------
| Every route requires an authenticated customer.
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.CUSTOMER));

/*
|--------------------------------------------------------------------------
| GET /api/v1/recently-viewed
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(getRecentlyViewedRequestSchema),
  getRecentlyViewedController,
);

/*
|--------------------------------------------------------------------------
| POST /api/v1/recently-viewed/:productId
|--------------------------------------------------------------------------
*/

router.post(
  "/:productId",
  validateRequest(recordRecentlyViewedRequestSchema),
  recordRecentlyViewedController,
);

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/recently-viewed/:productId
|--------------------------------------------------------------------------
*/

router.delete(
  "/:productId",
  validateRequest(deleteRecentlyViewedItemRequestSchema),
  deleteRecentlyViewedItemController,
);

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/recently-viewed
|--------------------------------------------------------------------------
*/

router.delete(
  "/",
  validateRequest(clearRecentlyViewedRequestSchema),
  clearRecentlyViewedController,
);

export default router;
