import { Router } from "express";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import {
  publicCategoryBySlugRequestSchema,
  publicCategoryListRequestSchema,
  publicCategoryTreeRequestSchema,
} from "./category.validation.js";

import {
  getPublicCategoryController,
  listPublicCategoriesController,
  getPublicCategoryTreeController,
} from "./category.public.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| List Public Categories
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(publicCategoryListRequestSchema),
  listPublicCategoriesController,
);

/*
|--------------------------------------------------------------------------
| Get Public Category Tree
|--------------------------------------------------------------------------
*/

router.get(
  "/tree",
  validateRequest(publicCategoryTreeRequestSchema),
  getPublicCategoryTreeController,
);

/*
|--------------------------------------------------------------------------
| Get Public Category by Slug
|--------------------------------------------------------------------------
*/

router.get(
  "/:slug",
  validateRequest(publicCategoryBySlugRequestSchema),
  getPublicCategoryController,
);

export default router;
