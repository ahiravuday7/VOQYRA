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
