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

const productParamsSchema = z
  .object({
    productId: productIdSchema,
  })
  .strict();

/*
|--------------------------------------------------------------------------
| GET /api/v1/recently-viewed
|--------------------------------------------------------------------------
*/

const getRecentlyViewedRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| POST /api/v1/recently-viewed/:productId
|--------------------------------------------------------------------------
| The backend generates viewedAt.
|--------------------------------------------------------------------------
*/

const recordRecentlyViewedRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: productParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/recently-viewed/:productId
|--------------------------------------------------------------------------
*/

const deleteRecentlyViewedItemRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: productParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| DELETE /api/v1/recently-viewed
|--------------------------------------------------------------------------
*/

const clearRecentlyViewedRequestSchema = z.object({
  body: optionalEmptyObjectSchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

export {
  clearRecentlyViewedRequestSchema,
  deleteRecentlyViewedItemRequestSchema,
  getRecentlyViewedRequestSchema,
  recordRecentlyViewedRequestSchema,
};
