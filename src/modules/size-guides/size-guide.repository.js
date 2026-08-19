import SizeGuide from "./size-guide.model.js";

import { SIZE_GUIDE_STATUSES } from "../../shared/constants/size-guide.constants.js";

/*
|--------------------------------------------------------------------------
| Find SizeGuide by ID
|--------------------------------------------------------------------------
*/

export const findSizeGuideById = (sizeGuideId, options = {}) => {
  const { session = null, includeDeleted = false } = options;

  const filter = {
    _id: sizeGuideId,
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  const query = SizeGuide.findOne(filter);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find SizeGuide by Slug
|--------------------------------------------------------------------------
|
| Deleted SizeGuides are intentionally included.
|
| Because slug has a globally unique index, a soft-deleted SizeGuide
| continues to own its slug.
|--------------------------------------------------------------------------
*/

export const findSizeGuideBySlug = (slug, options = {}) => {
  const { excludeSizeGuideId = null, session = null } = options;

  const filter = {
    slug,
  };

  if (excludeSizeGuideId) {
    filter._id = {
      $ne: excludeSizeGuideId,
    };
  }

  const query = SizeGuide.findOne(filter).select("_id slug deletedAt").lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Create SizeGuide Document
|--------------------------------------------------------------------------
*/

export const createSizeGuideDocument = (sizeGuideData, options = {}) => {
  const { session = null } = options;

  const sizeGuide = new SizeGuide(sizeGuideData);

  const saveOptions = session ? { session } : {};

  return sizeGuide.save(saveOptions);
};

/*
|--------------------------------------------------------------------------
| Save SizeGuide Document
|--------------------------------------------------------------------------
|
| Used later for:
|
| - update
| - soft delete
| - restore
|--------------------------------------------------------------------------
*/

export const saveSizeGuideDocument = (sizeGuide, options = {}) => {
  const { session = null } = options;

  const saveOptions = session ? { session } : {};

  return sizeGuide.save(saveOptions);
};

/*
|--------------------------------------------------------------------------
| Find SizeGuides
|--------------------------------------------------------------------------
|
| Used by the future admin listing service.
|
| Service will build:
|
| - search filters
| - status filters
| - category filters
| - unit filters
| - deleted filters
| - pagination
| - sorting
|--------------------------------------------------------------------------
*/

export const findSizeGuides = (filter, options = {}) => {
  const {
    skip = 0,

    limit = 20,

    sort = {
      sortOrder: 1,
      name: 1,
      _id: 1,
    },
  } = options;

  return SizeGuide.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

/*
|--------------------------------------------------------------------------
| Count SizeGuides
|--------------------------------------------------------------------------
*/

export const countSizeGuides = (filter) => {
  return SizeGuide.countDocuments(filter);
};

/*
|--------------------------------------------------------------------------
| Find Public SizeGuides
|--------------------------------------------------------------------------
|
| Public SizeGuides must always be:
|
| status = active
| deletedAt = null
|
| Internal fields are intentionally excluded.
|--------------------------------------------------------------------------
*/

export const findPublicSizeGuides = (filter = {}) => {
  return SizeGuide.find({
    ...filter,

    status: SIZE_GUIDE_STATUSES.ACTIVE,

    deletedAt: null,
  })
    .select(
      [
        "name",
        "slug",
        "description",
        "category",
        "unit",
        "columns",
        "rows",
        "howToMeasure",
        "fitNote",
        "sortOrder",
      ].join(" "),
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
| Find Public SizeGuide by Slug
|--------------------------------------------------------------------------
*/

export const findPublicSizeGuideBySlug = (slug) => {
  return SizeGuide.findOne({
    slug,

    status: SIZE_GUIDE_STATUSES.ACTIVE,

    deletedAt: null,
  })
    .select(
      [
        "name",
        "slug",
        "description",
        "category",
        "unit",
        "columns",
        "rows",
        "howToMeasure",
        "fitNote",
        "sortOrder",
      ].join(" "),
    )
    .lean();
};
