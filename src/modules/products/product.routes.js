import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createProductRequestSchema,
  productIdRequestSchema,
} from "./product.validation.js";

import {
  createProductController,
  getAdminProductController,
} from "./product.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Protect All Admin Product Routes
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

/*
|--------------------------------------------------------------------------
| Create Product
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/products
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  validateRequest(createProductRequestSchema),
  createProductController,
);

/*
|--------------------------------------------------------------------------
| Get Product by ID
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/products/:productId
|--------------------------------------------------------------------------
*/

router.get(
  "/:productId",
  validateRequest(productIdRequestSchema),
  getAdminProductController,
);

export default router;
