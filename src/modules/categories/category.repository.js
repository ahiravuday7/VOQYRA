import Category from "./category.model.js";

/*
| Find Category by ID
This finds an active category using its MongoDB ID.
*/

export const findCategoryById = (categoryId, options = {}) => {
  const { session = null } = options;

  const query = Category.findOne({
    _id: categoryId,
    deletedAt: null,
  });

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
