import * as z from "zod";

/*
|--------------------------------------------------------------------------
| MongoDB ObjectId
|--------------------------------------------------------------------------
*/

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, {
    error: "Return Request ID must be a valid MongoDB ObjectId",
  });

/*
|--------------------------------------------------------------------------
| Empty Object
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({}),
);

/*
|--------------------------------------------------------------------------
| Return Replacement Parameters
|--------------------------------------------------------------------------
*/

const returnReplacementParamsSchema = z.strictObject({
  returnRequestId: objectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Replacement ID Parameters
|--------------------------------------------------------------------------
*/

const replacementIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, {
    error: "Replacement ID must be a valid MongoDB ObjectId",
  });

const returnReplacementIdParamsSchema = z.strictObject({
  replacementId: replacementIdSchema,
});

/*
|--------------------------------------------------------------------------
| Process Return Replacement Body
|--------------------------------------------------------------------------
*/

const processOrderReturnReplacementBodySchema = z.strictObject({
  note: z
    .string({
      error: "Processing note must be text",
    })
    .trim()
    .min(3, {
      error: "Processing note must contain at least 3 characters",
    })
    .max(500, {
      error: "Processing note cannot exceed 500 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Process Return Replacement Request
|--------------------------------------------------------------------------
|
| POST
| /api/v1/admin/order-return-replacements/:replacementId/process
|--------------------------------------------------------------------------
*/

export const processOrderReturnReplacementRequestSchema = z.strictObject({
  body: processOrderReturnReplacementBodySchema,

  params: returnReplacementIdParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Create Return Replacement Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/replacement
|
| Replacement quantity, items, Product IDs, variant IDs, status,
| inventory values, actor and timestamps are backend-controlled.
|
| Therefore the request body is intentionally empty.
|--------------------------------------------------------------------------
*/

export const createOrderReturnReplacementRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: returnReplacementParamsSchema,

  query: emptyObjectSchema,
});
