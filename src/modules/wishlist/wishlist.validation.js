import { z } from "zod";

/*
|--------------------------------------------------------------------------
| ObjectId Validation
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

const emptyObjectSchema = z.object({}).strict();
const optionalEmptyObjectSchema = emptyObjectSchema.optional();

/*
|--------------------------------------------------------------------------
| GET /api/v1/wishlist
|--------------------------------------------------------------------------
*/

const getWishlistRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| POST /api/v1/wishlist/items
|--------------------------------------------------------------------------
| Only productId is accepted.
|--------------------------------------------------------------------------
*/

const addWishlistItemRequestSchema = z.object({
  body: z
    .object({
      productId: productIdSchema,
    })
    .strict(),

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/wishlist/items/:productId
|--------------------------------------------------------------------------
*/

const deleteWishlistItemRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: z
    .object({
      productId: productIdSchema,
    })
    .strict(),

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/wishlist
|--------------------------------------------------------------------------
*/

const clearWishlistRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

export {
  addWishlistItemRequestSchema,
  clearWishlistRequestSchema,
  deleteWishlistItemRequestSchema,
  getWishlistRequestSchema,
};
