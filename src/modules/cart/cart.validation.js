import { z } from "zod";

import { CART_LIMITS } from "./cart.constants.js";

/*
|--------------------------------------------------------------------------
| ObjectId Validation
|--------------------------------------------------------------------------
|
| Cart has three ObjectId values coming from requests:
|
| productId
| variantId
| itemId
|
| MongoDB ObjectIds are 24-character hexadecimal strings.
|--------------------------------------------------------------------------
*/

const objectIdSchema = (label) =>
  z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, `${label} must be a valid MongoDB ObjectId`);

/*
|--------------------------------------------------------------------------
| Shared Schemas
|--------------------------------------------------------------------------
*/

const productIdSchema = objectIdSchema("Product ID");

const variantIdSchema = objectIdSchema("Product variant ID");

const cartItemIdSchema = objectIdSchema("Cart item ID");

const quantitySchema = z
  .number({
    error: "Quantity must be a number",
  })
  .int("Quantity must be an integer")
  .min(1, "Quantity must be at least 1")
  .max(
    CART_LIMITS.MAX_QUANTITY_PER_ITEM,
    `Quantity cannot exceed ${CART_LIMITS.MAX_QUANTITY_PER_ITEM}`,
  );

const emptyObjectSchema = z.object({}).strict();

/*
|--------------------------------------------------------------------------
| GET /api/v1/cart
|--------------------------------------------------------------------------
*/

const getCartRequestSchema = z.object({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| POST /api/v1/cart/items
|--------------------------------------------------------------------------
|
| Adds:
|
| Product + Variant + Quantity
|--------------------------------------------------------------------------
*/

const addCartItemRequestSchema = z.object({
  body: z
    .object({
      productId: productIdSchema,

      variantId: variantIdSchema,

      quantity: quantitySchema,
    })
    .strict(),

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| PATCH /api/v1/cart/items/:itemId
|--------------------------------------------------------------------------
|
| This endpoint changes only quantity.
|--------------------------------------------------------------------------
*/

const updateCartItemRequestSchema = z.object({
  body: z
    .object({
      quantity: quantitySchema,
    })
    .strict(),

  params: z
    .object({
      itemId: cartItemIdSchema,
    })
    .strict(),

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/cart/items/:itemId
|--------------------------------------------------------------------------
*/

const deleteCartItemRequestSchema = z.object({
  body: emptyObjectSchema,

  params: z
    .object({
      itemId: cartItemIdSchema,
    })
    .strict(),

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/cart
|--------------------------------------------------------------------------
*/

const clearCartRequestSchema = z.object({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

export {
  addCartItemRequestSchema,
  clearCartRequestSchema,
  deleteCartItemRequestSchema,
  getCartRequestSchema,
  updateCartItemRequestSchema,
};
