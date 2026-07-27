import Category from "./category.model.js";

/*
| Find Category by ID
This finds an active category using its MongoDB ID.
*/

export const findCategoryById = (categoryId, options = {}) => {
  const { session = null, includeDeleted = false } = options;

  const filter = {
    _id: categoryId,
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  const query = Category.findOne(filter);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
| Find Category by Slug
This checks whether another category already uses a particular slug.
*/

export const findCategoryBySlug = (slug, options = {}) => {
  const { excludeCategoryId = null, session = null } = options;

  const filter = {
    slug,
    deletedAt: null,
  };

  if (excludeCategoryId) {
    filter._id = {
      $ne: excludeCategoryId,
    };
  }

  const query = Category.findOne(filter).select("_id slug").lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
| Create Category
This creates and saves a new category.
*/

export const createCategoryDocument = (categoryData, options = {}) => {
  const { session = null } = options;

  const category = new Category(categoryData);

  return category.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Category Descendants
|--------------------------------------------------------------------------
|
| A descendant contains the selected category ID
| inside its ancestors array.
|--------------------------------------------------------------------------
*/

// This finds every category below the selected category.
export const findCategoryDescendants = (categoryId, options = {}) => {
  const { session = null } = options;

  const query = Category.find({
    ancestors: categoryId,
    deletedAt: null,
  }).select("_id ancestors level");

  if (session) {
    query.session(session);
  }

  return query;
};

/*
| Update Descendant Hierarchy
*/

// This updates multiple descendants after a category moves.
export const updateCategoryDescendants = (descendantUpdates, options = {}) => {
  const { session = null } = options;

  if (!descendantUpdates.length) {
    return null;
  }

  const operations = descendantUpdates.map(
    ({ categoryId, ancestors, level }) => {
      return {
        updateOne: {
          filter: {
            _id: categoryId,
            deletedAt: null,
          },

          update: {
            $set: {
              ancestors,
              level,
            },
          },
        },
      };
    },
  );

  return Category.bulkWrite(operations, {
    session,
    ordered: true,
  });
};

/*
|--------------------------------------------------------------------------
| Find Categories
|--------------------------------------------------------------------------
*/

export const findCategories = (filter, options = {}) => {
  const {
    skip = 0,
    limit = 20,
    sort = {
      sortOrder: 1,
      name: 1,
      _id: 1,
    },
  } = options;

  return Category.find(filter).sort(sort).skip(skip).limit(limit).lean();
};

/*
|--------------------------------------------------------------------------
| Count Categories
|--------------------------------------------------------------------------
*/

export const countCategories = (filter) => {
  return Category.countDocuments(filter);
};

/*
|--------------------------------------------------------------------------
| Count Non-Deleted Child Categories
|--------------------------------------------------------------------------
*/

export const countCategoryChildren = (categoryId, options = {}) => {
  const { session = null } = options;

  const query = Category.countDocuments({
    parent: categoryId,
    deletedAt: null,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Public Categories
|--------------------------------------------------------------------------
*/

export const findPublicCategories = (filter) => {
  return Category.find(filter)
    .select(
      [
        "name",
        "slug",
        "description",
        "parent",
        "ancestors",
        "level",
        "image",
        "bannerImage",
        "seo",
        "isFeatured",
        "sortOrder",
      ].join(" "),
    )
    .sort({
      level: 1,
      sortOrder: 1,
      name: 1,
      _id: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| Find Public Category by Slug
|--------------------------------------------------------------------------
*/

export const findPublicCategoryBySlug = (slug) => {
  return Category.findOne({
    slug,
    status: "active",
    deletedAt: null,
  })
    .select(
      [
        "name",
        "slug",
        "description",
        "parent",
        "ancestors",
        "level",
        "image",
        "bannerImage",
        "seo",
        "isFeatured",
        "sortOrder",
      ].join(" "),
    )
    .lean();
};
