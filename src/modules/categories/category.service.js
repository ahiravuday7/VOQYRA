import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import {
  createCategoryDocument,
  findCategoryById,
  findCategoryBySlug,
  findCategoryDescendants,
  updateCategoryDescendants,
  countCategories,
  findCategories,
  countCategoryChildren,
  findPublicCategories,
  findPublicCategoryBySlug,
  countActiveCategoryDescendants,
  findCategoriesByIds,
} from "./category.repository.js";
import { CATEGORY_STATUSES } from "../../shared/constants/category.constants.js";

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
|--------------------------------------------------------------------------
| Check Whether Every Ancestor Is Active
|--------------------------------------------------------------------------
*/

const isAncestorPathActive = async (ancestorIds, options = {}) => {
  const { session = null } = options;

  if (!ancestorIds?.length) {
    return true;
  }

  const normalizedIds = [...new Set(ancestorIds.map(objectIdToString))];

  const ancestorCategories = await findCategoriesByIds(normalizedIds, {
    session,
    includeDeleted: true,
  });

  const ancestorMap = new Map(
    ancestorCategories.map((category) => [
      objectIdToString(category._id),
      category,
    ]),
  );

  return normalizedIds.every((ancestorId) => {
    const ancestor = ancestorMap.get(ancestorId);

    return Boolean(
      ancestor &&
      !ancestor.deletedAt &&
      ancestor.status === CATEGORY_STATUSES.ACTIVE,
    );
  });
};

/*
|--------------------------------------------------------------------------
| Require Active Ancestor Path
|--------------------------------------------------------------------------
*/

const ensureAncestorPathIsActive = async (ancestorIds, options = {}) => {
  const isActive = await isAncestorPathActive(ancestorIds, options);

  if (!isActive) {
    throw new AppError(
      "An active category requires every parent category to be active",
      409,
      {
        errorCode: "CATEGORY_ANCESTOR_INACTIVE",
      },
    );
  }
};

/*
|--------------------------------------------------------------------------
| Load Publicly Visible Categories
|--------------------------------------------------------------------------
|
| A category is publicly visible only when:
|
| - It is active
| - It is not deleted
| - Every ancestor is also active and non-deleted
|--------------------------------------------------------------------------
*/

const loadVisiblePublicCategories = async () => {
  const categories = await findPublicCategories({
    status: CATEGORY_STATUSES.ACTIVE,

    deletedAt: null,
  });

  const activeCategoryIds = new Set(
    categories.map((category) => objectIdToString(category._id)),
  );

  return categories.filter((category) => {
    return (category.ancestors ?? []).every((ancestorId) => {
      return activeCategoryIds.has(objectIdToString(ancestorId));
    });
  });
};

/*
| Create Category
*/

export const createCategory = async (categoryData, actorUserId) => {
  const { parent: parentId = null, ...categoryFields } = categoryData;

  await ensureCategorySlugIsAvailable(categoryFields.slug);

  const hierarchy = await buildCategoryHierarchy(parentId);

  const resultingStatus = categoryFields.status ?? CATEGORY_STATUSES.ACTIVE;

  if (resultingStatus === CATEGORY_STATUSES.ACTIVE) {
    await ensureAncestorPathIsActive(hierarchy.ancestors);
  }

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
| Validate Resulting Active State
|--------------------------------------------------------------------------
*/

    const resultingStatus = updateData.status ?? category.status;

    if (resultingStatus === CATEGORY_STATUSES.ACTIVE) {
      await ensureAncestorPathIsActive(hierarchy.ancestors, {
        session,
      });
    }

    /*
|--------------------------------------------------------------------------
| Prevent Inactive Parent with Active Descendants
|--------------------------------------------------------------------------
*/

    const isChangingToInactive =
      category.status === CATEGORY_STATUSES.ACTIVE &&
      updateData.status === CATEGORY_STATUSES.INACTIVE;

    if (isChangingToInactive) {
      const activeDescendantCount = await countActiveCategoryDescendants(
        category._id,
        {
          session,
        },
      );

      if (activeDescendantCount > 0) {
        throw new AppError(
          "Category cannot be made inactive while it contains active descendants",
          409,
          {
            errorCode: "CATEGORY_HAS_ACTIVE_DESCENDANTS",

            details: {
              activeDescendantCount,
            },
          },
        );
      }
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

/*
|--------------------------------------------------------------------------
| Escape Search Value
|--------------------------------------------------------------------------
|
| Prevent user input from being interpreted as
| regular-expression syntax.
|--------------------------------------------------------------------------
*/

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| Get Admin Category
|--------------------------------------------------------------------------
*/

export const getAdminCategory = async (categoryId, options = {}) => {
  const { includeDeleted = false } = options;

  const category = await findCategoryById(categoryId, {
    includeDeleted,
  });

  if (!category) {
    throw createCategoryNotFoundError();
  }

  return category;
};

/*
|--------------------------------------------------------------------------
| List Admin Categories
|--------------------------------------------------------------------------
*/

export const listAdminCategories = async (queryData) => {
  const {
    page,
    limit,
    search,
    status,
    parent,
    isFeatured,
    level,
    deleted,
    sortBy,
    sortDirection,
  } = queryData;

  /*
    |--------------------------------------------------------------------------
    | Build Database Filter
    |--------------------------------------------------------------------------
    */

  const filter = {};

  /*
|--------------------------------------------------------------------------
| Deleted Record Filter
|--------------------------------------------------------------------------
*/

  if (deleted === "exclude") {
    filter.deletedAt = null;
  }

  if (deleted === "only") {
    filter.deletedAt = {
      $ne: null,
    };
  }

  /*
   * deleted === "include"
   *
   * No deletedAt filter is added, so both deleted
   * and non-deleted categories are returned.
   */

  if (status) {
    filter.status = status;
  }

  if (typeof isFeatured === "boolean") {
    filter.isFeatured = isFeatured;
  }

  if (typeof level === "number") {
    filter.level = level;
  }

  if (parent === "root") {
    filter.parent = null;
  } else if (parent) {
    filter.parent = parent;
  }

  if (search) {
    const escapedSearch = escapeRegularExpression(search);

    const searchExpression = new RegExp(escapedSearch, "i");

    filter.$or = [
      {
        name: searchExpression,
      },
      {
        slug: searchExpression,
      },
      {
        description: searchExpression,
      },
    ];
  }

  /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

  const skip = (page - 1) * limit;

  /*
    |--------------------------------------------------------------------------
    | Sorting
    |--------------------------------------------------------------------------
    */

  const direction = sortDirection === "desc" ? -1 : 1;

  const sort = {
    [sortBy]: direction,
  };

  /*
   * Add stable secondary sorting.
   */
  if (sortBy !== "name") {
    sort.name = 1;
  }

  sort._id = direction;

  /*
    |--------------------------------------------------------------------------
    | Execute Queries
    |--------------------------------------------------------------------------
    */

  const [categories, totalItems] = await Promise.all([
    findCategories(filter, {
      skip,
      limit,
      sort,
    }),

    countCategories(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    categories,

    pagination: {
      page,
      limit,
      totalItems,
      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },

    filters: {
      search: search ?? null,

      status: status ?? null,

      parent: parent ?? null,

      isFeatured: typeof isFeatured === "boolean" ? isFeatured : null,

      level: typeof level === "number" ? level : null,

      deleted,

      sortBy,
      sortDirection,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Soft Delete Category
|--------------------------------------------------------------------------
*/

export const deleteCategory = async (categoryId, actorUserId) => {
  let deletedCategory = null;

  await mongoose.connection.transaction(async (session) => {
    const category = await findCategoryById(categoryId, {
      session,
      includeDeleted: true,
    });

    if (!category) {
      throw createCategoryNotFoundError();
    }

    /*
     * Deletion is idempotent.
     */
    if (category.deletedAt) {
      deletedCategory = category;
      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Protect Category Hierarchy
      |--------------------------------------------------------------------------
      */

    const childCount = await countCategoryChildren(category._id, {
      session,
    });

    if (childCount > 0) {
      throw new AppError(
        "Category cannot be deleted while it contains child categories",
        409,
        {
          errorCode: "CATEGORY_HAS_CHILDREN",

          details: {
            childCount,
          },
        },
      );
    }

    /*
      |--------------------------------------------------------------------------
      | Soft Delete
      |--------------------------------------------------------------------------
      */

    category.deletedAt = new Date();

    category.deletedBy = actorUserId;

    category.updatedBy = actorUserId;

    await category.save({
      session,
    });

    deletedCategory = category;
  });

  return deletedCategory;
};

/*
|--------------------------------------------------------------------------
| Restore Category
|--------------------------------------------------------------------------
*/

export const restoreCategory = async (categoryId, actorUserId) => {
  let restoredCategory = null;

  await mongoose.connection.transaction(async (session) => {
    const category = await findCategoryById(categoryId, {
      session,
      includeDeleted: true,
    });

    if (!category) {
      throw createCategoryNotFoundError();
    }

    /*
     * Restore is idempotent.
     */
    if (!category.deletedAt) {
      restoredCategory = category;
      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Check Parent Category
      |--------------------------------------------------------------------------
      |
      | A child category cannot be restored while
      | its parent remains deleted.
      |--------------------------------------------------------------------------
      */

    if (category.parent) {
      const parentCategory = await findCategoryById(category.parent, {
        session,
      });

      if (!parentCategory) {
        throw new AppError(
          "Restore the parent category before restoring this category",
          409,
          {
            errorCode: "CATEGORY_PARENT_UNAVAILABLE",
          },
        );
      }
    }

    /*
      |--------------------------------------------------------------------------
      | Restore Category
      |--------------------------------------------------------------------------
      */

    category.deletedAt = null;
    category.deletedBy = null;
    category.updatedBy = actorUserId;

    await category.save({
      session,
    });

    restoredCategory = category;
  });

  return restoredCategory;
};

/*
|--------------------------------------------------------------------------
| List Public Categories
|--------------------------------------------------------------------------
*/

export const listPublicCategories = async (queryData) => {
  const { parent, isFeatured, level } = queryData;

  const categories = await loadVisiblePublicCategories();

  return categories.filter((category) => {
    /*
     * Parent filter
     */
    if (parent === "root" && category.parent) {
      return false;
    }

    if (
      parent &&
      parent !== "root" &&
      objectIdToString(category.parent) !== parent
    ) {
      return false;
    }

    /*
     * Featured filter
     */
    if (typeof isFeatured === "boolean" && category.isFeatured !== isFeatured) {
      return false;
    }

    /*
     * Level filter
     */
    if (typeof level === "number" && category.level !== level) {
      return false;
    }

    return true;
  });
};

/*
|--------------------------------------------------------------------------
| Get Public Category by Slug
|--------------------------------------------------------------------------
*/

export const getPublicCategoryBySlug = async (slug) => {
  const category = await findPublicCategoryBySlug(slug);

  if (!category) {
    throw createCategoryNotFoundError();
  }

  const ancestorPathIsActive = await isAncestorPathActive(
    category.ancestors ?? [],
  );

  /*
   * Public callers receive the same 404 whether
   * the category or one of its ancestors is
   * unavailable.
   */
  if (!ancestorPathIsActive) {
    throw createCategoryNotFoundError();
  }

  return category;
};

/*
|--------------------------------------------------------------------------
| Build Public Category Tree
|--------------------------------------------------------------------------
*/

export const getPublicCategoryTree = async () => {
  /*
   * Load every active, non-deleted category.
   */
  const categories = await loadVisiblePublicCategories();

  /*
   * Create one mutable tree node for every
   * category.
   */
  const categoryNodeMap = new Map();

  for (const category of categories) {
    categoryNodeMap.set(String(category._id), {
      ...category,
      children: [],
    });
  }

  const rootCategories = [];

  /*
   * Connect every category to its parent.
   */
  for (const category of categories) {
    const categoryId = String(category._id);

    const categoryNode = categoryNodeMap.get(categoryId);

    /*
     * Category has no parent, so it is
     * a root-category node.
     */
    if (!category.parent) {
      rootCategories.push(categoryNode);

      continue;
    }

    const parentNode = categoryNodeMap.get(String(category.parent));

    /*
     * Only attach the category when its parent
     * is also active and non-deleted.
     *
     * This prevents an active child category
     * from appearing publicly underneath an
     * inactive parent.
     */
    if (parentNode) {
      parentNode.children.push(categoryNode);
    }
  }

  return rootCategories;
};
