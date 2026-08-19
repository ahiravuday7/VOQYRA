import { Router } from "express";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import {
  publicBrandListRequestSchema,
  publicBrandBySlugRequestSchema,
} from "./brand.validation.js";

import {
  listPublicBrandsController,
  getPublicBrandController,
} from "./brand.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| List Public Brands
|--------------------------------------------------------------------------
|
| GET /api/v1/brands
|
| Public route.
| Authentication is not required.
|
| Supports:
|
| ?isFeatured=true
| ?isFeatured=false
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(publicBrandListRequestSchema),
  listPublicBrandsController,
);

/*
|--------------------------------------------------------------------------
| Get Public Brand by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/brands/:slug
|
| Examples:
|
| /api/v1/brands/nike
| /api/v1/brands/adidas
| /api/v1/brands/levis
|--------------------------------------------------------------------------
*/

router.get(
  "/:slug",
  validateRequest(publicBrandBySlugRequestSchema),
  getPublicBrandController,
);

export default router;
