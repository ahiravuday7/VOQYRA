import { createCategory, updateCategory } from "./category.service.js";

import { toAdminCategory } from "./category.mapper.js";

/*
|--------------------------------------------------------------------------
| Create Category
|--------------------------------------------------------------------------
|
| Intended route:
|
| POST /api/v1/admin/categories
|--------------------------------------------------------------------------
*/

export const createCategoryController = async (request, response) => {
  const categoryData = request.validated.body;

  const actorUserId = request.user._id;

  const category = await createCategory(categoryData, actorUserId);

  request.log?.info(
    {
      categoryId: category._id,

      actorUserId,
    },
    "Category created",
  );

  return response.status(201).json({
    success: true,

    message: "Category created successfully",

    data: {
      category: toAdminCategory(category),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Update Category
|--------------------------------------------------------------------------
|
| Intended route:
|
| PATCH /api/v1/admin/categories/:categoryId
|--------------------------------------------------------------------------
*/

export const updateCategoryController = async (request, response) => {
  const { categoryId } = request.validated.params;

  const categoryData = request.validated.body;

  const actorUserId = request.user._id;

  const category = await updateCategory(categoryId, categoryData, actorUserId);

  request.log?.info(
    {
      categoryId: category._id,

      actorUserId,
    },
    "Category updated",
  );

  return response.status(200).json({
    success: true,

    message: "Category updated successfully",

    data: {
      category: toAdminCategory(category),
    },
  });
};
