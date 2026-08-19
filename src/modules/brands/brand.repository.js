import Brand from "./brand.model.js";
import { BRAND_STATUSES } from "../../shared/constants/brand.constants.js";

/*
|--------------------------------------------------------------------------
| Find Brand by ID
|--------------------------------------------------------------------------
*/

export const findBrandById = (brandId, options = {}) => {
  const { session = null, includeDeleted = false } = options;

  const filter = {
    _id: brandId,
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  const query = Brand.findOne(filter);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Brand by Slug
|--------------------------------------------------------------------------
|
| Deleted brands are included intentionally.
|
| The Brand model uses a globally unique slug index, so a soft-deleted
| brand still owns its slug and a new brand must not reuse it.
|--------------------------------------------------------------------------
*/

export const findBrandBySlug = (slug, options = {}) => {
  const { excludeBrandId = null, session = null } = options;

  const filter = {
    slug,
  };

  if (excludeBrandId) {
    filter._id = {
      $ne: excludeBrandId,
    };
  }

  const query = Brand.findOne(filter).select("_id slug deletedAt").lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Create Brand Document
|--------------------------------------------------------------------------
*/

export const createBrandDocument = (brandData, options = {}) => {
  const { session = null } = options;

  const brand = new Brand(brandData);

  return brand.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Save Brand Document
|--------------------------------------------------------------------------
*/

export const saveBrandDocument = (brand, options = {}) => {
  const { session = null } = options;

  return brand.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Brands
|--------------------------------------------------------------------------
|
| Used by the admin listing service.
|
| The service will be responsible for:
|
| - filters
| - search
| - pagination
| - sorting
|--------------------------------------------------------------------------
*/

export const findBrands = (filter, options = {}) => {
  const {
    skip = 0,

    limit = 20,

    sort = {
      sortOrder: 1,
      name: 1,
      _id: 1,
    },
  } = options;

  return Brand.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

/*
|--------------------------------------------------------------------------
| Count Brands
|--------------------------------------------------------------------------
*/

export const countBrands = (filter) => {
  return Brand.countDocuments(filter);
};

/*
|--------------------------------------------------------------------------
| Find Public Brands
|--------------------------------------------------------------------------
|
| Only customer-safe Brand fields are selected.
|
| Internal fields such as:
|
| - createdBy
| - updatedBy
| - deletedBy
| - deletedAt
|
| are not returned.
|--------------------------------------------------------------------------
*/

export const findPublicBrands = (filter = {}) => {
  return Brand.find({
    ...filter,

    status: BRAND_STATUSES.ACTIVE,

    deletedAt: null,
  })
    .select(
      ["name", "slug", "description", "logo", "isFeatured", "sortOrder"].join(
        " ",
      ),
    )
    .sort({
      sortOrder: 1,
      name: 1,
      _id: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| Find Public Brand by Slug
|--------------------------------------------------------------------------
*/

export const findPublicBrandBySlug = (slug) => {
  return Brand.findOne({
    slug,

    status: BRAND_STATUSES.ACTIVE,

    deletedAt: null,
  })
    .select(
      ["name", "slug", "description", "logo", "isFeatured", "sortOrder"].join(
        " ",
      ),
    )
    .lean();
};
