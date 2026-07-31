import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";
import authorizeRoles from "../../middlewares/authorize.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  createProductRequestSchema,
  productIdRequestSchema,
  adminProductListRequestSchema,
  updateProductRequestSchema,
  adjustProductInventoryRequestSchema,
  commitProductInventoryRequestSchema,
  releaseProductInventoryRequestSchema,
  reserveProductInventoryRequestSchema,
} from "./product.validation.js";

import {
  createProductController,
  getAdminProductController,
  getAdminProductsController,
  updateProductController,
  deleteProductController,
  restoreProductController,
  adjustProductInventoryController,
  commitProductInventoryController,
  releaseProductInventoryController,
  reserveProductInventoryController,
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
| List Admin Products
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(adminProductListRequestSchema),
  getAdminProductsController,
);

/*
|--------------------------------------------------------------------------
| Product Inventory Operations
|--------------------------------------------------------------------------
*/
/*
|--------------------------------------------------------------------------
| Adjust Product Variant Inventory
|--------------------------------------------------------------------------
|
| PATCH
| /api/v1/admin/products/:productId/variants/:variantId/inventory
|--------------------------------------------------------------------------
*/

router.patch(
  "/:productId/variants/:variantId/inventory",
  validateRequest(adjustProductInventoryRequestSchema),
  adjustProductInventoryController,
);

/*
|--------------------------------------------------------------------------
| Reserve Product Variant Inventory
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/products/:productId/variants/:variantId/inventory/reserve
|--------------------------------------------------------------------------
*/

router.post(
  "/:productId/variants/:variantId/inventory/reserve",
  validateRequest(reserveProductInventoryRequestSchema),
  reserveProductInventoryController,
);

/*
|--------------------------------------------------------------------------
| Release Product Variant Reservation
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/products/:productId/variants/:variantId/inventory/release
|--------------------------------------------------------------------------
*/

router.post(
  "/:productId/variants/:variantId/inventory/release",
  validateRequest(releaseProductInventoryRequestSchema),
  releaseProductInventoryController,
);

/*
|--------------------------------------------------------------------------
| Commit Product Variant Reservation
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/products/:productId/variants/:variantId/inventory/commit
|--------------------------------------------------------------------------
*/

router.post(
  "/:productId/variants/:variantId/inventory/commit",
  validateRequest(commitProductInventoryRequestSchema),
  commitProductInventoryController,
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

/*
|--------------------------------------------------------------------------
| Restore Product
|--------------------------------------------------------------------------
*/

router.patch(
  "/:productId/restore",
  validateRequest(productIdRequestSchema),
  restoreProductController,
);

/*
|--------------------------------------------------------------------------
| Update Product
|--------------------------------------------------------------------------
*/

router.patch(
  "/:productId",
  validateRequest(updateProductRequestSchema),
  updateProductController,
);

/*
|--------------------------------------------------------------------------
| Soft Delete Product
|--------------------------------------------------------------------------
*/

router.delete(
  "/:productId",
  validateRequest(productIdRequestSchema),
  deleteProductController,
);

export default router;
