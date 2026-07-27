import {
  createCategory,
  updateCategory,
  getAdminCategory,
  listAdminCategories,
  deleteCategory,
  restoreCategory,
  getPublicCategoryBySlug,
  getPublicCategoryTree,
  listPublicCategories,
  getAdminCategoryTree,
} from "./category.service.js";

import {
  toAdminCategory,
  toPublicCategory,
  toPublicCategoryTree,
  toAdminCategoryTree,
} from "./category.mapper.js";

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

/*
|--------------------------------------------------------------------------
| List Categories
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/categories
|--------------------------------------------------------------------------
*/

export const listCategoriesController = async (request, response) => {
  const result = await listAdminCategories(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Categories retrieved successfully",

    data: {
      categories: result.categories.map(toAdminCategory),

      pagination: result.pagination,

      filters: result.filters,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Category
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/categories/:categoryId
|--------------------------------------------------------------------------
*/

export const getCategoryController = async (request, response) => {
  const { categoryId } = request.validated.params;

  const { includeDeleted } = request.validated.query;

  const category = await getAdminCategory(categoryId, {
    includeDeleted,
  });

  return response.status(200).json({
    success: true,

    message: "Category retrieved successfully",

    data: {
      category: toAdminCategory(category),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Delete Category
|--------------------------------------------------------------------------
|
| DELETE /api/v1/admin/categories/:categoryId
|--------------------------------------------------------------------------
*/

export const deleteCategoryController = async (request, response) => {
  const { categoryId } = request.validated.params;

  const actorUserId = request.user._id;

  const category = await deleteCategory(categoryId, actorUserId);

  request.log?.info(
    {
      categoryId: category._id,

      actorUserId,
    },
    "Category soft deleted",
  );

  return response.status(200).json({
    success: true,

    message: "Category deleted successfully",

    data: {
      category: toAdminCategory(category),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Restore Category
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/categories/:categoryId/restore
|--------------------------------------------------------------------------
*/

export const restoreCategoryController = async (request, response) => {
  const { categoryId } = request.validated.params;

  const actorUserId = request.user._id;

  const category = await restoreCategory(categoryId, actorUserId);

  request.log?.info(
    {
      categoryId: category._id,

      actorUserId,
    },
    "Category restored",
  );

  return response.status(200).json({
    success: true,

    message: "Category restored successfully",

    data: {
      category: toAdminCategory(category),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Category Tree
|--------------------------------------------------------------------------
|
| GET /api/v1/categories/tree
|--------------------------------------------------------------------------
*/

export const getPublicCategoryTreeController = async (request, response) => {
  const categoryTree = await getPublicCategoryTree();

  return response.status(200).json({
    success: true,

    message: "Category tree retrieved successfully",

    data: {
      categories: categoryTree.map(toPublicCategoryTree),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Admin Category Tree
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/categories/tree
|--------------------------------------------------------------------------
*/

export const getAdminCategoryTreeController = async (request, response) => {
  const result = await getAdminCategoryTree(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Admin category tree retrieved successfully",

    data: {
      categories: result.categories.map(toAdminCategoryTree),

      filters: {
        deleted: result.deletedFilter,
      },
    },
  });
};
