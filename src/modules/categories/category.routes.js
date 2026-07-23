import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
} from "./category.validation.js";

import {
  createCategoryController,
  updateCategoryController,
} from "./category.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect All Admin Category Routes
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| Create Category
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/categories
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  validateRequest(createCategoryRequestSchema),
  createCategoryController,
);

/*
|--------------------------------------------------------------------------
| Update Category
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/categories/:categoryId
|--------------------------------------------------------------------------
*/

router.patch(
  "/:categoryId",
  validateRequest(updateCategoryRequestSchema),
  updateCategoryController,
);

export default router;
