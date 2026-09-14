import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  addWishlistItemController,
  clearWishlistController,
  deleteWishlistItemController,
  getWishlistController,
} from "./wishlist.controller.js";

import {
  addWishlistItemRequestSchema,
  clearWishlistRequestSchema,
  deleteWishlistItemRequestSchema,
  getWishlistRequestSchema,
} from "./wishlist.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer Wishlist Authentication
|--------------------------------------------------------------------------
| Every route requires an authenticated customer.
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.CUSTOMER));

/*
|--------------------------------------------------------------------------
| GET /api/v1/wishlist
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  validateRequest(getWishlistRequestSchema),
  getWishlistController,
);

/*
|--------------------------------------------------------------------------
| POST /api/v1/wishlist/items
|--------------------------------------------------------------------------
*/

router.post(
  "/items",
  validateRequest(addWishlistItemRequestSchema),
  addWishlistItemController,
);

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/wishlist/items/:productId
|--------------------------------------------------------------------------
*/

router.delete(
  "/items/:productId",
  validateRequest(deleteWishlistItemRequestSchema),
  deleteWishlistItemController,
);

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/wishlist
|--------------------------------------------------------------------------
*/

router.delete(
  "/",
  validateRequest(clearWishlistRequestSchema),
  clearWishlistController,
);

export default router;
