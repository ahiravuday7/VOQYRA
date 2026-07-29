import Product from "./product.model.js";

/*
|--------------------------------------------------------------------------
| Find Product by ID
|--------------------------------------------------------------------------
*/

export const findProductById = (productId, options = {}) => {
  const { session = null, includeDeleted = false } = options;

  const filter = {
    _id: productId,
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  const query = Product.findOne(filter);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Product by Slug
|--------------------------------------------------------------------------
|
| Deleted products are included intentionally.
|
| The database unique index includes deleted products,
| so a deleted product still owns its slug.
|--------------------------------------------------------------------------
*/

export const findProductBySlug = (slug, options = {}) => {
  const { excludeProductId = null, session = null } = options;

  const filter = {
    slug,
  };

  if (excludeProductId) {
    filter._id = {
      $ne: excludeProductId,
    };
  }

  const query = Product.findOne(filter).select("_id slug").lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Products Containing Any Requested SKU
|--------------------------------------------------------------------------
|
| Deleted products are included because SKUs remain
| protected by the global unique database index.
|--------------------------------------------------------------------------
*/

export const findProductsByVariantSkus = (skus, options = {}) => {
  const { excludeProductId = null, session = null } = options;

  if (!skus?.length) {
    return [];
  }

  const filter = {
    "variants.sku": {
      $in: skus,
    },
  };

  if (excludeProductId) {
    filter._id = {
      $ne: excludeProductId,
    };
  }

  const query = Product.find(filter).select("_id slug variants.sku").lean();

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Create Product Document
|--------------------------------------------------------------------------
*/

export const createProductDocument = async (productData, options = {}) => {
  const { session = null } = options;

  const product = new Product(productData);

  return product.save({
    session,
  });
};
