import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import {
  createCategoryDocument,
  findCategoryById,
  findCategoryBySlug,
  findCategoryDescendants,
  updateCategoryDescendants,
} from "./category.repository.js";

/*
| Category Errors
*/

const createCategoryNotFoundError = () => {
  return new AppError("Category was not found", 404, {
    errorCode: "CATEGORY_NOT_FOUND",
  });
};

const createParentNotFoundError = () => {
  return new AppError("Parent category was not found", 400, {
    errorCode: "PARENT_CATEGORY_NOT_FOUND",
  });
};

const createDuplicateSlugError = () => {
  return new AppError("A category with this slug already exists", 409, {
    errorCode: "CATEGORY_SLUG_ALREADY_EXISTS",
  });
};

/*
| Convert Object IDs to Strings
*/

const objectIdToString = (value) => {
  return String(value);
};

/*
|--------------------------------------------------------------------------
| Build Category Ancestry
|--------------------------------------------------------------------------
|
| Root category:
|
| parent: null
| ancestors: []
| level: 0
|
| Child category:
|
| parent: PARENT_ID
| ancestors: [...parent.ancestors, parent._id]
| level: ancestors.length
|--------------------------------------------------------------------------
*/

const buildCategoryHierarchy = async (parentId, options = {}) => {
  const { categoryId = null, session = null } = options;

  if (!parentId) {
    return {
      parent: null,
      ancestors: [],
      level: 0,
    };
  }

  /*
   * A category cannot select itself
   * as its immediate parent.
   */
  if (
    categoryId &&
    objectIdToString(parentId) === objectIdToString(categoryId)
  ) {
    throw new AppError("A category cannot be its own parent", 400, {
      errorCode: "CATEGORY_CANNOT_BE_OWN_PARENT",
    });
  }

  const parentCategory = await findCategoryById(parentId, {
    session,
  });

  if (!parentCategory) {
    throw createParentNotFoundError();
  }

  /*
   * When updating a category, the new parent
   * cannot be one of that category's descendants.
   *
   * Example:
   *
   * Men
   * └── Topwear
   *
   * Men cannot be moved under Topwear.
   */
  if (categoryId) {
    const parentAncestorIds = parentCategory.ancestors.map(objectIdToString);

    if (parentAncestorIds.includes(objectIdToString(categoryId))) {
      throw new AppError(
        "A category cannot be moved under one of its descendants",
        400,
        {
          errorCode: "CIRCULAR_CATEGORY_HIERARCHY",
        },
      );
    }
  }

  const ancestors = [...parentCategory.ancestors, parentCategory._id];

  return {
    parent: parentCategory._id,
    ancestors,
    level: ancestors.length,
  };
};

/*
| Ensure Category Slug Is Available
*/

const ensureCategorySlugIsAvailable = async (slug, options = {}) => {
  const existingCategory = await findCategoryBySlug(slug, options);

  if (existingCategory) {
    throw createDuplicateSlugError();
  }
};

/*
| Create Category
*/

export const createCategory = async (categoryData, actorUserId) => {
  const { parent: parentId = null, ...categoryFields } = categoryData;

  await ensureCategorySlugIsAvailable(categoryFields.slug);

  const hierarchy = await buildCategoryHierarchy(parentId);

  const category = await createCategoryDocument({
    ...categoryFields,

    parent: hierarchy.parent,

    ancestors: hierarchy.ancestors,

    level: hierarchy.level,

    createdBy: actorUserId,

    updatedBy: actorUserId,
  });

  return category;
};

/*
|--------------------------------------------------------------------------
| Build Descendant Updates
|--------------------------------------------------------------------------
|
| Example before moving Topwear:
|
| Men
| └── Topwear
|     └── T-Shirts
|
| T-Shirts ancestors:
|
| [Men, Topwear]
|
| If Topwear is moved under Women:
|
| T-Shirts ancestors become:
|
| [Women, Topwear]
|--------------------------------------------------------------------------
*/

const buildDescendantHierarchyUpdates = ({
  category,
  descendants,
  newAncestors,
}) => {
  const previousCategoryPath = [...category.ancestors, category._id].map(
    objectIdToString,
  );

  const replacementCategoryPath = [...newAncestors, category._id];

  return descendants.map((descendant) => {
    const currentAncestors = descendant.ancestors.map(objectIdToString);

    /*
     * Everything after the category itself
     * represents the descendant's relative path.
     */
    const relativeAncestors = currentAncestors.slice(
      previousCategoryPath.length,
    );

    const updatedAncestors = [
      ...replacementCategoryPath,

      ...relativeAncestors.map(
        (ancestorId) => new mongoose.Types.ObjectId(ancestorId),
      ),
    ];

    return {
      categoryId: descendant._id,

      ancestors: updatedAncestors,

      level: updatedAncestors.length,
    };
  });
};

/*
|--------------------------------------------------------------------------
| Update Category
|--------------------------------------------------------------------------
*/

export const updateCategory = async (categoryId, updateData, actorUserId) => {
  let updatedCategory = null;

  await mongoose.connection.transaction(async (session) => {
    const category = await findCategoryById(categoryId, {
      session,
    });

    if (!category) {
      throw createCategoryNotFoundError();
    }

    /*
     * Save the previous hierarchy before
     * modifying the category.
     */
    const previousAncestors = [...category.ancestors];

    /*
      |--------------------------------------------------------------------------
      | Validate Slug
      |--------------------------------------------------------------------------
      */

    if (updateData.slug && updateData.slug !== category.slug) {
      await ensureCategorySlugIsAvailable(updateData.slug, {
        excludeCategoryId: category._id,

        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Determine Whether Parent Is Changing
      |--------------------------------------------------------------------------
      */

    const parentWasProvided = Object.prototype.hasOwnProperty.call(
      updateData,
      "parent",
    );

    let hierarchy = {
      parent: category.parent,
      ancestors: category.ancestors,
      level: category.level,
    };

    let parentIsChanging = false;

    if (parentWasProvided) {
      hierarchy = await buildCategoryHierarchy(updateData.parent, {
        categoryId: category._id,

        session,
      });

      const currentParentId = category.parent
        ? objectIdToString(category.parent)
        : null;

      const newParentId = hierarchy.parent
        ? objectIdToString(hierarchy.parent)
        : null;

      parentIsChanging = currentParentId !== newParentId;
    }

    /*
      |--------------------------------------------------------------------------
      | Assign Editable Fields
      |--------------------------------------------------------------------------
      */

    const editableFields = [
      "name",
      "slug",
      "description",
      "image",
      "bannerImage",
      "seo",
      "status",
      "isFeatured",
      "sortOrder",
    ];

    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        category[field] = updateData[field];
      }
    }

    /*
      |--------------------------------------------------------------------------
      | Load Descendants Before Moving Category
      |--------------------------------------------------------------------------
      */

    let descendants = [];

    if (parentIsChanging) {
      descendants = await findCategoryDescendants(category._id, {
        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Update Category Hierarchy
      |--------------------------------------------------------------------------
      */

    if (parentWasProvided) {
      category.parent = hierarchy.parent;

      category.ancestors = hierarchy.ancestors;

      category.level = hierarchy.level;
    }

    category.updatedBy = actorUserId;

    await category.save({
      session,
    });

    /*
      |--------------------------------------------------------------------------
      | Update Descendant Hierarchies
      |--------------------------------------------------------------------------
      */

    if (parentIsChanging && descendants.length) {
      const previousCategoryPath = [...previousAncestors, category._id].map(
        objectIdToString,
      );

      const replacementCategoryPath = [...hierarchy.ancestors, category._id];

      const descendantUpdates = descendants.map((descendant) => {
        const currentAncestors = descendant.ancestors.map(objectIdToString);

        const relativeAncestorIds = currentAncestors.slice(
          previousCategoryPath.length,
        );

        const updatedAncestors = [
          ...replacementCategoryPath,

          ...relativeAncestorIds.map((ancestorId) => {
            return new mongoose.Types.ObjectId(ancestorId);
          }),
        ];

        return {
          categoryId: descendant._id,

          ancestors: updatedAncestors,

          level: updatedAncestors.length,
        };
      });

      await updateCategoryDescendants(descendantUpdates, {
        session,
      });
    }

    updatedCategory = category;
  });

  return updatedCategory;
};
