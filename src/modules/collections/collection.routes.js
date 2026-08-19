import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createCollectionRequestSchema,
  updateCollectionRequestSchema,
  collectionIdRequestSchema,
  collectionListRequestSchema,
  getCollectionRequestSchema,
} from "./collection.validation.js";

import {
  createCollectionController,
  updateCollectionController,
  getCollectionController,
  listCollectionsController,
  deleteCollectionController,
  restoreCollectionController,
} from "./collection.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect All Admin Collection Routes
|--------------------------------------------------------------------------
|
| Every route below requires:
|
| 1. Authentication
| 2. ADMIN role
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| List Collections
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/collections
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(collectionListRequestSchema),
  listCollectionsController,
);

/*
|--------------------------------------------------------------------------
| Create Collection
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/collections
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  validateRequest(createCollectionRequestSchema),
  createCollectionController,
);

/*
|--------------------------------------------------------------------------
| Restore Collection
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/collections/:collectionId/restore
|
| Keep this special action before the generic /:collectionId PATCH route.
|--------------------------------------------------------------------------
*/

router.patch(
  "/:collectionId/restore",
  validateRequest(collectionIdRequestSchema),
  restoreCollectionController,
);

/*
|--------------------------------------------------------------------------
| Get Collection by ID
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/collections/:collectionId
|--------------------------------------------------------------------------
*/

router.get(
  "/:collectionId",
  validateRequest(getCollectionRequestSchema),
  getCollectionController,
);

/*
|--------------------------------------------------------------------------
| Update Collection
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/collections/:collectionId
|--------------------------------------------------------------------------
*/

router.patch(
  "/:collectionId",
  validateRequest(updateCollectionRequestSchema),
  updateCollectionController,
);

/*
|--------------------------------------------------------------------------
| Soft Delete Collection
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/collections/:collectionId
|--------------------------------------------------------------------------
*/

router.delete(
  "/:collectionId",
  validateRequest(collectionIdRequestSchema),
  deleteCollectionController,
);

export default router;
