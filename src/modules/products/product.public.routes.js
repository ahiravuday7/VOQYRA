import { Router } from "express";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import {
  publicProductDetailsRequestSchema,
  publicProductListRequestSchema,
} from "./product.validation.js";

import {
  getPublicProductController,
  getPublicProductsController,
} from "./product.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| List Public Products
|--------------------------------------------------------------------------
|
| GET /api/v1/products
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(publicProductListRequestSchema),
  getPublicProductsController,
);

/*
|--------------------------------------------------------------------------
| Get Public Product by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/products/:slug
|--------------------------------------------------------------------------
*/

router.get(
  "/:slug",
  validateRequest(publicProductDetailsRequestSchema),
  getPublicProductController,
);

export default router;
