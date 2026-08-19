import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import { CATEGORY_STATUSES } from "../../shared/constants/category.constants.js";

import { SIZE_GUIDE_STATUSES } from "../../shared/constants/size-guide.constants.js";

import {
  findCategoryById,
  findCategoriesByIds,
} from "../categories/category.repository.js";

import {
  createSizeGuideDocument,
  findSizeGuideById,
  findSizeGuideBySlug,
  saveSizeGuideDocument,
  findSizeGuides,
  countSizeGuides,
  findPublicSizeGuides,
  findPublicSizeGuideBySlug,
} from "./size-guide.repository.js";

/*
|--------------------------------------------------------------------------
| SizeGuide Errors
|--------------------------------------------------------------------------
*/

const createSizeGuideNotFoundError = () => {
  return new AppError("Size guide was not found", 404, {
    errorCode: "SIZE_GUIDE_NOT_FOUND",
  });
};

const createDuplicateSlugError = () => {
  return new AppError("A size guide with this slug already exists", 409, {
    errorCode: "SIZE_GUIDE_SLUG_ALREADY_EXISTS",
  });
};

const createSizeGuideCategoryNotFoundError = () => {
  return new AppError("Size guide category was not found", 400, {
    errorCode: "SIZE_GUIDE_CATEGORY_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| ObjectId Utility
|--------------------------------------------------------------------------
*/

const objectIdToString = (value) => {
  return String(value);
};

/*
|--------------------------------------------------------------------------
| Ensure SizeGuide Slug Is Available
|--------------------------------------------------------------------------
*/

const ensureSizeGuideSlugIsAvailable = async (slug, options = {}) => {
  const existingSizeGuide = await findSizeGuideBySlug(slug, options);

  if (existingSizeGuide) {
    throw createDuplicateSlugError();
  }
};

/*
|--------------------------------------------------------------------------
| Ensure Category Ancestors Are Active
|--------------------------------------------------------------------------
|
| Active SizeGuides linked to a Category require the complete
| Category path to be publicly available.
|--------------------------------------------------------------------------
*/

const ensureCategoryAncestorsAreActive = async (ancestorIds, options = {}) => {
  const { session = null } = options;

  if (!ancestorIds?.length) {
    return;
  }

  const normalizedAncestorIds = [...new Set(ancestorIds.map(objectIdToString))];

  const ancestors = await findCategoriesByIds(normalizedAncestorIds, {
    session,

    includeDeleted: true,
  });

  const ancestorMap = new Map(
    ancestors.map((ancestor) => [objectIdToString(ancestor._id), ancestor]),
  );

  const invalidAncestorId = normalizedAncestorIds.find((ancestorId) => {
    const ancestor = ancestorMap.get(ancestorId);

    return (
      !ancestor ||
      ancestor.deletedAt ||
      ancestor.status !== CATEGORY_STATUSES.ACTIVE
    );
  });

  if (invalidAncestorId) {
    throw new AppError(
      "An active size guide requires every category ancestor to be active",
      409,
      {
        errorCode: "SIZE_GUIDE_CATEGORY_ANCESTOR_UNAVAILABLE",

        details: {
          categoryId: invalidAncestorId,
        },
      },
    );
  }
};

/*
|--------------------------------------------------------------------------
| Validate SizeGuide Category
|--------------------------------------------------------------------------
|
| Rules:
|
| category = null
|     → allowed
|
| inactive SizeGuide
|     → Category must exist and not be deleted
|
| active SizeGuide
|     → Category must exist
|     → Category must be active
|     → every Category ancestor must be active
|--------------------------------------------------------------------------
*/

const validateSizeGuideCategory = async (
  categoryId,
  sizeGuideStatus,
  options = {},
) => {
  const { session = null } = options;

  /*
   * Generic SizeGuides may have
   * no Category.
   */
  if (!categoryId) {
    return null;
  }

  const category = await findCategoryById(categoryId, {
    session,
  });

  if (!category) {
    throw createSizeGuideCategoryNotFoundError();
  }

  /*
   * Inactive SizeGuides may be
   * prepared against an inactive
   * Category.
   */
  if (sizeGuideStatus !== SIZE_GUIDE_STATUSES.ACTIVE) {
    return category;
  }

  /*
   * Active SizeGuide requires
   * active Category.
   */
  if (category.status !== CATEGORY_STATUSES.ACTIVE) {
    throw new AppError(
      "An active size guide requires an active category",
      409,
      {
        errorCode: "SIZE_GUIDE_CATEGORY_INACTIVE",
      },
    );
  }

  await ensureCategoryAncestorsAreActive(category.ancestors, {
    session,
  });

  return category;
};

/*
|--------------------------------------------------------------------------
| Create SizeGuide
|--------------------------------------------------------------------------
*/

export const createSizeGuide = async (sizeGuideData, actorUserId) => {
  await ensureSizeGuideSlugIsAvailable(sizeGuideData.slug);

  const resultingStatus = sizeGuideData.status ?? SIZE_GUIDE_STATUSES.ACTIVE;

  const categoryId = sizeGuideData.category ?? null;

  await validateSizeGuideCategory(categoryId, resultingStatus);

  return createSizeGuideDocument({
    ...sizeGuideData,

    category: categoryId,

    createdBy: actorUserId,

    updatedBy: actorUserId,
  });
};

/*
|--------------------------------------------------------------------------
| Update SizeGuide
|--------------------------------------------------------------------------
*/

export const updateSizeGuide = async (sizeGuideId, updateData, actorUserId) => {
  let updatedSizeGuide = null;

  await mongoose.connection.transaction(async (session) => {
    const sizeGuide = await findSizeGuideById(sizeGuideId, {
      session,
    });

    if (!sizeGuide) {
      throw createSizeGuideNotFoundError();
    }

    /*
        |--------------------------------------------------------------------------
        | Slug Validation
        |--------------------------------------------------------------------------
        */

    if (updateData.slug && updateData.slug !== sizeGuide.slug) {
      await ensureSizeGuideSlugIsAvailable(updateData.slug, {
        excludeSizeGuideId: sizeGuide._id,

        session,
      });
    }

    /*
        |--------------------------------------------------------------------------
        | Determine Resulting Status + Category
        |--------------------------------------------------------------------------
        |
        | Important for PATCH.
        |
        | Example:
        |
        | Existing:
        | status = inactive
        | category = inactive category
        |
        | PATCH:
        | { status: "active" }
        |
        | We must validate the EXISTING category before activating.
        |--------------------------------------------------------------------------
        */

    const resultingStatus = Object.prototype.hasOwnProperty.call(
      updateData,
      "status",
    )
      ? updateData.status
      : sizeGuide.status;

    const resultingCategory = Object.prototype.hasOwnProperty.call(
      updateData,
      "category",
    )
      ? updateData.category
      : sizeGuide.category;

    await validateSizeGuideCategory(resultingCategory, resultingStatus, {
      session,
    });

    /*
        |--------------------------------------------------------------------------
        | Apply Editable Fields
        |--------------------------------------------------------------------------
        */

    const editableFields = [
      "name",
      "slug",
      "description",
      "category",
      "unit",
      "columns",
      "rows",
      "howToMeasure",
      "fitNote",
      "status",
      "sortOrder",
    ];

    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        sizeGuide[field] = updateData[field];
      }
    }

    sizeGuide.updatedBy = actorUserId;

    /*
     * Mongoose validation now checks
     * the final merged document.
     *
     * This is especially important
     * when PATCH supplies only:
     *
     * - columns
     * OR
     * - rows
     */
    await saveSizeGuideDocument(sizeGuide, {
      session,
    });

    updatedSizeGuide = sizeGuide;
  });

  return updatedSizeGuide;
};

/*
|--------------------------------------------------------------------------
| Get Admin SizeGuide
|--------------------------------------------------------------------------
*/

export const getAdminSizeGuide = async (sizeGuideId, options = {}) => {
  const { includeDeleted = false } = options;

  const sizeGuide = await findSizeGuideById(sizeGuideId, {
    includeDeleted,
  });

  if (!sizeGuide) {
    throw createSizeGuideNotFoundError();
  }

  return sizeGuide;
};

/*
|--------------------------------------------------------------------------
| Escape Search Regular Expression
|--------------------------------------------------------------------------
*/

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| List Admin SizeGuides
|--------------------------------------------------------------------------
*/

export const listAdminSizeGuides = async (queryData) => {
  const {
    page,
    limit,
    search,
    status,
    unit,
    category,
    deleted,
    sortBy,
    sortDirection,
  } = queryData;

  const filter = {};

  /*
    |--------------------------------------------------------------------------
    | Deleted Filter
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
   * No deletedAt filter.
   */

  /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

  if (status) {
    filter.status = status;
  }

  /*
    |--------------------------------------------------------------------------
    | Unit
    |--------------------------------------------------------------------------
    */

  if (unit) {
    filter.unit = unit;
  }

  /*
    |--------------------------------------------------------------------------
    | Category
    |--------------------------------------------------------------------------
    */

  if (category === "none") {
    filter.category = null;
  } else if (category) {
    filter.category = category;
  }

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

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

      {
        howToMeasure: searchExpression,
      },

      {
        fitNote: searchExpression,
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

  if (sortBy !== "name") {
    sort.name = 1;
  }

  sort._id = direction;

  /*
    |--------------------------------------------------------------------------
    | Execute Queries
    |--------------------------------------------------------------------------
    */

  const [sizeGuides, totalItems] = await Promise.all([
    findSizeGuides(filter, {
      skip,
      limit,
      sort,
    }),

    countSizeGuides(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    sizeGuides,

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

      unit: unit ?? null,

      category: category ?? null,

      deleted,

      sortBy,

      sortDirection,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Soft Delete SizeGuide
|--------------------------------------------------------------------------
*/

export const deleteSizeGuide = async (sizeGuideId, actorUserId) => {
  let deletedSizeGuide = null;

  await mongoose.connection.transaction(async (session) => {
    const sizeGuide = await findSizeGuideById(sizeGuideId, {
      session,

      includeDeleted: true,
    });

    if (!sizeGuide) {
      throw createSizeGuideNotFoundError();
    }

    /*
     * Idempotent delete.
     */
    if (sizeGuide.deletedAt) {
      deletedSizeGuide = sizeGuide;

      return;
    }

    sizeGuide.deletedAt = new Date();

    sizeGuide.deletedBy = actorUserId;

    sizeGuide.updatedBy = actorUserId;

    await saveSizeGuideDocument(sizeGuide, {
      session,
    });

    deletedSizeGuide = sizeGuide;
  });

  return deletedSizeGuide;
};

/*
|--------------------------------------------------------------------------
| Restore SizeGuide
|--------------------------------------------------------------------------
*/

export const restoreSizeGuide = async (sizeGuideId, actorUserId) => {
  let restoredSizeGuide = null;

  await mongoose.connection.transaction(async (session) => {
    const sizeGuide = await findSizeGuideById(sizeGuideId, {
      session,

      includeDeleted: true,
    });

    if (!sizeGuide) {
      throw createSizeGuideNotFoundError();
    }

    /*
     * Idempotent restore.
     */
    if (!sizeGuide.deletedAt) {
      restoredSizeGuide = sizeGuide;

      return;
    }

    /*
     * Important:
     *
     * An active SizeGuide being restored
     * becomes publicly available again.
     *
     * Revalidate its Category first because
     * that Category may have changed while
     * the SizeGuide was deleted.
     */
    await validateSizeGuideCategory(sizeGuide.category, sizeGuide.status, {
      session,
    });

    sizeGuide.deletedAt = null;

    sizeGuide.deletedBy = null;

    sizeGuide.updatedBy = actorUserId;

    await saveSizeGuideDocument(sizeGuide, {
      session,
    });

    restoredSizeGuide = sizeGuide;
  });

  return restoredSizeGuide;
};

/*
|--------------------------------------------------------------------------
| List Public SizeGuides
|--------------------------------------------------------------------------
|
| Repository automatically enforces:
|
| status = active
| deletedAt = null
|--------------------------------------------------------------------------
*/

export const listPublicSizeGuides = async (queryData) => {
  const { category, unit } = queryData;

  const filter = {};

  if (category === "none") {
    filter.category = null;
  } else if (category) {
    filter.category = category;
  }

  if (unit) {
    filter.unit = unit;
  }

  return findPublicSizeGuides(filter);
};

/*
|--------------------------------------------------------------------------
| Get Public SizeGuide by Slug
|--------------------------------------------------------------------------
*/

export const getPublicSizeGuideBySlug = async (slug) => {
  const sizeGuide = await findPublicSizeGuideBySlug(slug);

  if (!sizeGuide) {
    throw createSizeGuideNotFoundError();
  }

  return sizeGuide;
};
