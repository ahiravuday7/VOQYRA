import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import {
  createBrandDocument,
  findBrandById,
  findBrandBySlug,
  saveBrandDocument,
  findBrands,
  countBrands,
  findPublicBrands,
  findPublicBrandBySlug,
} from "./brand.repository.js";

/*
|--------------------------------------------------------------------------
| Brand Errors
|--------------------------------------------------------------------------
*/

const createBrandNotFoundError = () => {
  return new AppError("Brand was not found", 404, {
    errorCode: "BRAND_NOT_FOUND",
  });
};

const createDuplicateSlugError = () => {
  return new AppError("A brand with this slug already exists", 409, {
    errorCode: "BRAND_SLUG_ALREADY_EXISTS",
  });
};

/*
|--------------------------------------------------------------------------
| Ensure Brand Slug Is Available
|--------------------------------------------------------------------------
|
| Brand slugs remain globally unique even after soft deletion.
|
| Example:
|
| Nike
| slug: nike
|
| If Nike is soft deleted, another Brand cannot reuse "nike".
|--------------------------------------------------------------------------
*/

const ensureBrandSlugIsAvailable = async (slug, options = {}) => {
  const existingBrand = await findBrandBySlug(slug, options);

  if (existingBrand) {
    throw createDuplicateSlugError();
  }
};

/*
|--------------------------------------------------------------------------
| Create Brand
|--------------------------------------------------------------------------
*/

export const createBrand = async (brandData, actorUserId) => {
  await ensureBrandSlugIsAvailable(brandData.slug);

  const brand = await createBrandDocument({
    ...brandData,

    createdBy: actorUserId,

    updatedBy: actorUserId,
  });

  return brand;
};

/*
|--------------------------------------------------------------------------
| Update Brand
|--------------------------------------------------------------------------
*/

export const updateBrand = async (brandId, updateData, actorUserId) => {
  let updatedBrand = null;

  await mongoose.connection.transaction(async (session) => {
    const brand = await findBrandById(brandId, {
      session,
    });

    if (!brand) {
      throw createBrandNotFoundError();
    }

    /*
      |--------------------------------------------------------------------------
      | Validate Slug
      |--------------------------------------------------------------------------
      */

    if (updateData.slug && updateData.slug !== brand.slug) {
      await ensureBrandSlugIsAvailable(updateData.slug, {
        excludeBrandId: brand._id,

        session,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Update Normal Fields
      |--------------------------------------------------------------------------
      */

    const editableFields = [
      "name",
      "slug",
      "description",
      "status",
      "isFeatured",
      "sortOrder",
    ];

    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(updateData, field)) {
        brand[field] = updateData[field];
      }
    }

    /*
      |--------------------------------------------------------------------------
      | Update Logo
      |--------------------------------------------------------------------------
      |
      | Logo is merged instead of completely replaced.
      |
      | Existing:
      |
      | {
      |   url: "...",
      |   publicId: "...",
      |   altText: "Nike"
      | }
      |
      | PATCH:
      |
      | {
      |   "logo": {
      |     "altText": "Nike logo"
      |   }
      | }
      |
      | Only altText changes.
      |--------------------------------------------------------------------------
      */

    if (Object.prototype.hasOwnProperty.call(updateData, "logo")) {
      const existingLogo =
        typeof brand.logo?.toObject === "function"
          ? brand.logo.toObject()
          : (brand.logo ?? {});

      brand.logo = {
        ...existingLogo,

        ...updateData.logo,
      };
    }

    brand.updatedBy = actorUserId;

    await saveBrandDocument(brand, {
      session,
    });

    updatedBrand = brand;
  });

  return updatedBrand;
};

/*
|--------------------------------------------------------------------------
| Escape Regular Expression
|--------------------------------------------------------------------------
|
| Prevent search input from becoming executable
| regular-expression syntax.
|
| Example:
|
| User search:
|
| Nike.*
|
| should be treated as normal text,
| not regex syntax.
|--------------------------------------------------------------------------
*/

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| Get Admin Brand
|--------------------------------------------------------------------------
*/

export const getAdminBrand = async (brandId, options = {}) => {
  const { includeDeleted = false } = options;

  const brand = await findBrandById(brandId, {
    includeDeleted,
  });

  if (!brand) {
    throw createBrandNotFoundError();
  }

  return brand;
};

/*
|--------------------------------------------------------------------------
| List Admin Brands
|--------------------------------------------------------------------------
*/

export const listAdminBrands = async (queryData) => {
  const {
    page,
    limit,
    search,
    status,
    isFeatured,
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
   * No deletedAt condition is added.
   */

  /*
  |--------------------------------------------------------------------------
  | Status Filter
  |--------------------------------------------------------------------------
  */

  if (status) {
    filter.status = status;
  }

  /*
  |--------------------------------------------------------------------------
  | Featured Filter
  |--------------------------------------------------------------------------
  */

  if (typeof isFeatured === "boolean") {
    filter.isFeatured = isFeatured;
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

  const [brands, totalItems] = await Promise.all([
    findBrands(filter, {
      skip,
      limit,
      sort,
    }),

    countBrands(filter),
  ]);

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    brands,

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

      isFeatured: typeof isFeatured === "boolean" ? isFeatured : null,

      deleted,

      sortBy,

      sortDirection,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Soft Delete Brand
|--------------------------------------------------------------------------
|
| Brand deletion is idempotent.
|
| Calling DELETE twice does not produce
| an error.
|--------------------------------------------------------------------------
*/

export const deleteBrand = async (brandId, actorUserId) => {
  let deletedBrand = null;

  await mongoose.connection.transaction(async (session) => {
    const brand = await findBrandById(brandId, {
      session,

      includeDeleted: true,
    });

    if (!brand) {
      throw createBrandNotFoundError();
    }

    /*
     * Already deleted.
     */
    if (brand.deletedAt) {
      deletedBrand = brand;

      return;
    }

    brand.deletedAt = new Date();

    brand.deletedBy = actorUserId;

    brand.updatedBy = actorUserId;

    await saveBrandDocument(brand, {
      session,
    });

    deletedBrand = brand;
  });

  return deletedBrand;
};

/*
|--------------------------------------------------------------------------
| Restore Brand
|--------------------------------------------------------------------------
|
| Restore is also idempotent.
|--------------------------------------------------------------------------
*/

export const restoreBrand = async (brandId, actorUserId) => {
  let restoredBrand = null;

  await mongoose.connection.transaction(async (session) => {
    const brand = await findBrandById(brandId, {
      session,

      includeDeleted: true,
    });

    if (!brand) {
      throw createBrandNotFoundError();
    }

    /*
     * Brand is already active from
     * the soft-deletion perspective.
     */
    if (!brand.deletedAt) {
      restoredBrand = brand;

      return;
    }

    brand.deletedAt = null;

    brand.deletedBy = null;

    brand.updatedBy = actorUserId;

    await saveBrandDocument(brand, {
      session,
    });

    restoredBrand = brand;
  });

  return restoredBrand;
};

/*
|--------------------------------------------------------------------------
| List Public Brands
|--------------------------------------------------------------------------
|
| Repository automatically enforces:
|
| status = active
| deletedAt = null
|--------------------------------------------------------------------------
*/

export const listPublicBrands = async (queryData) => {
  const { isFeatured } = queryData;

  const filter = {};

  if (typeof isFeatured === "boolean") {
    filter.isFeatured = isFeatured;
  }

  return findPublicBrands(filter);
};

/*
|--------------------------------------------------------------------------
| Get Public Brand by Slug
|--------------------------------------------------------------------------
|
| Inactive or deleted Brands appear as
| not found to public callers.
|--------------------------------------------------------------------------
*/

export const getPublicBrandBySlug = async (slug) => {
  const brand = await findPublicBrandBySlug(slug);

  if (!brand) {
    throw createBrandNotFoundError();
  }

  return brand;
};
