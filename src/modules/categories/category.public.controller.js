import {
  getPublicCategoryBySlug,
  listPublicCategories,
  getPublicCategoryTree,
} from "./category.service.js";

import { toPublicCategory, toPublicCategoryTree } from "./category.mapper.js";

/*
|--------------------------------------------------------------------------
| List Public Categories
|--------------------------------------------------------------------------
|
| GET /api/v1/categories
|--------------------------------------------------------------------------
*/

export const listPublicCategoriesController = async (request, response) => {
  const categories = await listPublicCategories(request.validated.query);

  return response.status(200).json({
    success: true,

    message: "Categories retrieved successfully",

    data: {
      categories: categories.map(toPublicCategory),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Category by Slug
|--------------------------------------------------------------------------
|
| GET /api/v1/categories/:slug
|--------------------------------------------------------------------------
*/

export const getPublicCategoryController = async (request, response) => {
  const { slug } = request.validated.params;

  const category = await getPublicCategoryBySlug(slug);

  return response.status(200).json({
    success: true,

    message: "Category retrieved successfully",

    data: {
      category: toPublicCategory(category),
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
