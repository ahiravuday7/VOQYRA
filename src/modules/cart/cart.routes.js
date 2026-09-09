import { Router } from "express";

import authenticate from "../../middlewares/authenticate.middleware.js";

import authorizeRoles from "../../middlewares/authorize.middleware.js";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { USER_ROLES } from "../../shared/constants/user.constants.js";

import {
  addCartItemController,
  clearCartController,
  deleteCartItemController,
  getCartController,
  updateCartItemController,
} from "./cart.controller.js";

import {
  addCartItemRequestSchema,
  clearCartRequestSchema,
  deleteCartItemRequestSchema,
  getCartRequestSchema,
  updateCartItemRequestSchema,
} from "./cart.validation.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer Cart Authentication
|--------------------------------------------------------------------------
|
| Every Cart route requires:
|
| - Authenticated user
| - Customer role
|--------------------------------------------------------------------------
*/

router.use(authenticate, authorizeRoles(USER_ROLES.CUSTOMER));

/*
|--------------------------------------------------------------------------
| Get Cart
|--------------------------------------------------------------------------
|
| GET
| /api/v1/cart
|--------------------------------------------------------------------------
*/

router.get("/", validateRequest(getCartRequestSchema), getCartController);

/*
|--------------------------------------------------------------------------
| Add Cart Item
|--------------------------------------------------------------------------
|
| POST
| /api/v1/cart/items
|--------------------------------------------------------------------------
*/

router.post(
  "/items",
  validateRequest(addCartItemRequestSchema),
  addCartItemController,
);

/*
|--------------------------------------------------------------------------
| Update Cart Item Quantity
|--------------------------------------------------------------------------
|
| PATCH
| /api/v1/cart/items/:itemId
|--------------------------------------------------------------------------
*/

router.patch(
  "/items/:itemId",
  validateRequest(updateCartItemRequestSchema),
  updateCartItemController,
);

/*
|--------------------------------------------------------------------------
| Delete Cart Item
|--------------------------------------------------------------------------
|
| DELETE
| /api/v1/cart/items/:itemId
|--------------------------------------------------------------------------
*/

router.delete(
  "/items/:itemId",
  validateRequest(deleteCartItemRequestSchema),
  deleteCartItemController,
);

/*
|--------------------------------------------------------------------------
| Clear Cart
|--------------------------------------------------------------------------
|
| DELETE
| /api/v1/cart
|--------------------------------------------------------------------------
*/

router.delete(
  "/",
  validateRequest(clearCartRequestSchema),
  clearCartController,
);

export default router;
