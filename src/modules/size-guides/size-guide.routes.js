import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createSizeGuideRequestSchema,
  updateSizeGuideRequestSchema,
  sizeGuideIdRequestSchema,
  sizeGuideListRequestSchema,
  getSizeGuideRequestSchema,
} from "./size-guide.validation.js";

import {
  createSizeGuideController,
  updateSizeGuideController,
  getSizeGuideController,
  listSizeGuidesController,
  deleteSizeGuideController,
  restoreSizeGuideController,
} from "./size-guide.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect All Admin SizeGuide Routes
|--------------------------------------------------------------------------
|
| Every route below requires:
|
| 1. Authenticated user
| 2. ADMIN role
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| List SizeGuides
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/size-guides
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(sizeGuideListRequestSchema),
  listSizeGuidesController,
);

/*
|--------------------------------------------------------------------------
| Create SizeGuide
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/size-guides
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  validateRequest(createSizeGuideRequestSchema),
  createSizeGuideController,
);

/*
|--------------------------------------------------------------------------
| Restore SizeGuide
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/size-guides/:sizeGuideId/restore
|
| Keep this route before the generic /:sizeGuideId PATCH route.
|--------------------------------------------------------------------------
*/

router.patch(
  "/:sizeGuideId/restore",
  validateRequest(sizeGuideIdRequestSchema),
  restoreSizeGuideController,
);

/*
|--------------------------------------------------------------------------
| Get SizeGuide by ID
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/size-guides/:sizeGuideId
|--------------------------------------------------------------------------
*/

router.get(
  "/:sizeGuideId",
  validateRequest(getSizeGuideRequestSchema),
  getSizeGuideController,
);

/*
|--------------------------------------------------------------------------
| Update SizeGuide
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/size-guides/:sizeGuideId
|--------------------------------------------------------------------------
*/

router.patch(
  "/:sizeGuideId",
  validateRequest(updateSizeGuideRequestSchema),
  updateSizeGuideController,
);

/*
|--------------------------------------------------------------------------
| Soft Delete SizeGuide
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/size-guides/:sizeGuideId
|--------------------------------------------------------------------------
*/

router.delete(
  "/:sizeGuideId",
  validateRequest(sizeGuideIdRequestSchema),
  deleteSizeGuideController,
);

export default router;
