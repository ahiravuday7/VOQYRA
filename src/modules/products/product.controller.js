import { createProduct } from "./product.service.js";

import { toAdminProduct } from "./product.mapper.js";

/*
|--------------------------------------------------------------------------
| Create Product
|--------------------------------------------------------------------------
|
| Intended route:
|
| POST /api/v1/admin/products
|--------------------------------------------------------------------------
*/

export const createProductController = async (request, response) => {
  const productData = request.validated.body;

  const actorUserId = request.user._id;

  const product = await createProduct(productData, actorUserId);

  request.log?.info(
    {
      productId: product._id,

      productSlug: product.slug,

      actorUserId,
    },
    "Product created",
  );

  return response.status(201).json({
    success: true,

    message: "Product created successfully",

    data: {
      product: toAdminProduct(product),
    },
  });
};
