import mongoose from "mongoose";
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

/*
|--------------------------------------------------------------------------
| Save Product Document
|--------------------------------------------------------------------------
*/

export const saveProductDocument = async (product, options = {}) => {
  const { session = null } = options;

  return product.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Escape Search Regular Expression
|--------------------------------------------------------------------------
|
| Prevents search characters such as:
|
| . * + ? ^ $ { } ( ) | [ ] \
|
| from being interpreted as regular-expression operators.
|--------------------------------------------------------------------------
*/

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
|--------------------------------------------------------------------------
| Admin Product Sort Fields
|--------------------------------------------------------------------------
*/

const ADMIN_PRODUCT_SORT_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "name",
  "brand",
  "status",
  "publishedAt",
]);

/*
|--------------------------------------------------------------------------
| Build Admin Product Match Filter
|--------------------------------------------------------------------------
*/

const buildAdminProductMatchFilter = (filters) => {
  const match = {};

  /*
    |--------------------------------------------------------------------------
    | Deleted State
    |--------------------------------------------------------------------------
    */

  if (filters.deleted === "only") {
    match.deletedAt = {
      $ne: null,
    };
  } else if (filters.deleted !== "include") {
    match.deletedAt = null;
  }

  /*
    |--------------------------------------------------------------------------
    | Category
    |--------------------------------------------------------------------------
    */

  if (filters.category) {
    match.category = new mongoose.Types.ObjectId(filters.category);
  }

  /*
    |--------------------------------------------------------------------------
    | Product Status
    |--------------------------------------------------------------------------
    */

  if (filters.status) {
    match.status = filters.status;
  }

  /*
    |--------------------------------------------------------------------------
    | Product Flags
    |--------------------------------------------------------------------------
    |
    | Explicitly check against undefined because false
    | is also a valid filter value.
    |--------------------------------------------------------------------------
    */

  if (filters.isFeatured !== undefined) {
    match.isFeatured = filters.isFeatured;
  }

  if (filters.isNewArrival !== undefined) {
    match.isNewArrival = filters.isNewArrival;
  }

  if (filters.isBestSeller !== undefined) {
    match.isBestSeller = filters.isBestSeller;
  }

  /*
    |--------------------------------------------------------------------------
    | Product Search
    |--------------------------------------------------------------------------
    |
    | Searches:
    |
    | - Name
    | - Slug
    | - Brand
    | - Tags
    | - Variant SKU
    |--------------------------------------------------------------------------
    */

  if (filters.search) {
    const escapedSearch = escapeRegularExpression(filters.search);

    const searchExpression = new RegExp(escapedSearch, "i");

    match.$or = [
      {
        name: searchExpression,
      },
      {
        slug: searchExpression,
      },
      {
        brand: searchExpression,
      },
      {
        tags: searchExpression,
      },
      {
        "variants.sku": searchExpression,
      },
    ];
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Build Active Variant Stock Field
|--------------------------------------------------------------------------
|
| Creates a temporary internal array:
|
| __activeVariantStock: [
|   {
|     availableStock: 18,
|     lowStockThreshold: 5
|   }
| ]
|
| availableStock = stock - reservedStock
|--------------------------------------------------------------------------
*/

const buildActiveVariantStockStage = () => {
  return {
    $addFields: {
      __activeVariantStock: {
        $map: {
          input: {
            $filter: {
              input: {
                $ifNull: ["$variants", []],
              },

              as: "variant",

              /*
               * Missing isActive is treated as active
               * for compatibility with older documents.
               */
              cond: {
                $ne: ["$$variant.isActive", false],
              },
            },
          },

          as: "variant",

          in: {
            availableStock: {
              $let: {
                vars: {
                  stock: {
                    $ifNull: ["$$variant.inventory.stock", 0],
                  },

                  reservedStock: {
                    $ifNull: ["$$variant.inventory.reservedStock", 0],
                  },
                },

                in: {
                  $max: [
                    {
                      $subtract: ["$$stock", "$$reservedStock"],
                    },
                    0,
                  ],
                },
              },
            },

            lowStockThreshold: {
              $ifNull: ["$$variant.inventory.lowStockThreshold", 0],
            },
          },
        },
      },
    },
  };
};

/*
|--------------------------------------------------------------------------
| Build Stock Status Stage
|--------------------------------------------------------------------------
*/

const buildStockStatusStage = (stockStatus) => {
  if (!stockStatus) {
    return null;
  }

  /*
    |--------------------------------------------------------------------------
    | In Stock
    |--------------------------------------------------------------------------
    |
    | At least one active variant has available stock.
    |--------------------------------------------------------------------------
    */

  if (stockStatus === "in-stock") {
    return {
      $match: {
        __activeVariantStock: {
          $elemMatch: {
            availableStock: {
              $gt: 0,
            },
          },
        },
      },
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Low Stock
    |--------------------------------------------------------------------------
    |
    | At least one active variant:
    |
    | availableStock > 0
    | availableStock <= lowStockThreshold
    |--------------------------------------------------------------------------
    */

  if (stockStatus === "low-stock") {
    return {
      $match: {
        $expr: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: "$__activeVariantStock",

                  as: "variantStock",

                  cond: {
                    $and: [
                      {
                        $gt: ["$$variantStock.availableStock", 0],
                      },
                      {
                        $lte: [
                          "$$variantStock.availableStock",
                          "$$variantStock.lowStockThreshold",
                        ],
                      },
                    ],
                  },
                },
              },
            },
            0,
          ],
        },
      },
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Out of Stock
    |--------------------------------------------------------------------------
    |
    | No active variant has available stock.
    |--------------------------------------------------------------------------
    */

  if (stockStatus === "out-of-stock") {
    return {
      $match: {
        $expr: {
          $eq: [
            {
              $size: {
                $filter: {
                  input: "$__activeVariantStock",

                  as: "variantStock",

                  cond: {
                    $gt: ["$$variantStock.availableStock", 0],
                  },
                },
              },
            },
            0,
          ],
        },
      },
    };
  }

  return null;
};

/*
|--------------------------------------------------------------------------
| List Admin Products
|--------------------------------------------------------------------------
*/

export const listAdminProducts = async (filters) => {
  const {
    page = 1,
    limit = 20,
    stockStatus,
    sortBy = "createdAt",
    sortDirection = "desc",
  } = filters;

  const skip = (page - 1) * limit;

  /*
   * Validation already protects this value,
   * but the repository keeps a defensive fallback.
   */
  const normalizedSortBy = ADMIN_PRODUCT_SORT_FIELDS.has(sortBy)
    ? sortBy
    : "createdAt";

  const normalizedSortDirection = sortDirection === "asc" ? 1 : -1;

  const matchFilter = buildAdminProductMatchFilter(filters);

  const stockStatusStage = buildStockStatusStage(stockStatus);

  const pipeline = [
    /*
      |--------------------------------------------------------------------------
      | Normal Product Filters
      |--------------------------------------------------------------------------
      */

    {
      $match: matchFilter,
    },

    /*
      |--------------------------------------------------------------------------
      | Calculate Active Variant Stock
      |--------------------------------------------------------------------------
      */

    buildActiveVariantStockStage(),
  ];

  /*
    |--------------------------------------------------------------------------
    | Apply Stock Filter
    |--------------------------------------------------------------------------
    */

  if (stockStatusStage) {
    pipeline.push(stockStatusStage);
  }

  /*
    |--------------------------------------------------------------------------
    | Pagination and Total Count
    |--------------------------------------------------------------------------
    |
    | $facet runs both pipelines against the same
    | filtered Product result set.
    |--------------------------------------------------------------------------
    */

  pipeline.push({
    $facet: {
      products: [
        {
          $sort: {
            [normalizedSortBy]: normalizedSortDirection,

            /*
             * Stable sorting when two fields
             * contain the same value.
             */
            _id: normalizedSortDirection,
          },
        },

        {
          $skip: skip,
        },

        {
          $limit: limit,
        },

        /*
         * Remove the internal stock calculation
         * before returning Product documents.
         */
        {
          $unset: "__activeVariantStock",
        },
      ],

      metadata: [
        {
          $count: "totalItems",
        },
      ],
    },
  });

  const [result] = await Product.aggregate(pipeline);

  const products = result?.products ?? [];

  const totalItems = result?.metadata?.[0]?.totalItems ?? 0;

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    products,

    pagination: {
      page,
      limit,
      totalItems,
      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};
