import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  categoryIdRequestSchema,
  categoryListRequestSchema,
  getCategoryRequestSchema,
} from "./category.validation.js";

import {
  createCategoryController,
  updateCategoryController,
  getCategoryController,
  listCategoriesController,
  deleteCategoryController,
  restoreCategoryController,
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
| List Categories
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(categoryListRequestSchema),
  listCategoriesController,
);

/*
|--------------------------------------------------------------------------
| Get Category by ID
|--------------------------------------------------------------------------
*/

router.get(
  "/:categoryId",
  validateRequest(getCategoryRequestSchema),
  getCategoryController,
);

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
| Restore Category
|--------------------------------------------------------------------------
*/

router.patch(
  "/:categoryId/restore",
  validateRequest(categoryIdRequestSchema),
  restoreCategoryController,
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

/*
|--------------------------------------------------------------------------
| Delete Category
|--------------------------------------------------------------------------
*/

router.delete(
  "/:categoryId",
  validateRequest(categoryIdRequestSchema),
  deleteCategoryController,
);

export default router;
