import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createBrandRequestSchema,
  updateBrandRequestSchema,
  brandIdRequestSchema,
  brandListRequestSchema,
  getBrandRequestSchema,
} from "./brand.validation.js";

import {
  createBrandController,
  updateBrandController,
  getBrandController,
  listBrandsController,
  deleteBrandController,
  restoreBrandController,
} from "./brand.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect All Admin Brand Routes
|--------------------------------------------------------------------------
|
| Every route in this router requires:
|
| 1. Authentication
| 2. Admin role
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| List Brands
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/brands
|--------------------------------------------------------------------------
*/

router.get("/", validateRequest(brandListRequestSchema), listBrandsController);

/*
|--------------------------------------------------------------------------
| Get Brand by ID
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/brands/:brandId
|--------------------------------------------------------------------------
*/

router.get(
  "/:brandId",
  validateRequest(getBrandRequestSchema),
  getBrandController,
);

/*
|--------------------------------------------------------------------------
| Create Brand
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/brands
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  validateRequest(createBrandRequestSchema),
  createBrandController,
);

/*
|--------------------------------------------------------------------------
| Restore Brand
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/brands/:brandId/restore
|
| IMPORTANT:
| Keep this route before "/:brandId".
|--------------------------------------------------------------------------
*/

router.patch(
  "/:brandId/restore",
  validateRequest(brandIdRequestSchema),
  restoreBrandController,
);

/*
|--------------------------------------------------------------------------
| Update Brand
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/brands/:brandId
|--------------------------------------------------------------------------
*/

router.patch(
  "/:brandId",
  validateRequest(updateBrandRequestSchema),
  updateBrandController,
);

/*
|--------------------------------------------------------------------------
| Soft Delete Brand
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/brands/:brandId
|--------------------------------------------------------------------------
*/

router.delete(
  "/:brandId",
  validateRequest(brandIdRequestSchema),
  deleteBrandController,
);

export default router;
