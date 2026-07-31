import mongoose from "mongoose";
import { CATEGORY_STATUSES } from "../../shared/constants/category.constants.js";
import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";
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

/*
|--------------------------------------------------------------------------
| Build Public Product Match Filter
|--------------------------------------------------------------------------
*/

const buildPublicProductMatchFilter = (filters = {}) => {
  const match = {
    status: PRODUCT_STATUSES.ACTIVE,

    deletedAt: null,

    /*
     * Future publication dates are not publicly visible.
     */
    publishedAt: {
      $lte: new Date(),
    },
  };

  /*
    |--------------------------------------------------------------------------
    | Exact Category Filter
    |--------------------------------------------------------------------------
    */

  if (filters.category) {
    match.category = new mongoose.Types.ObjectId(filters.category);
  }

  /*
    |--------------------------------------------------------------------------
    | Product Flags
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
    | Public Search
    |--------------------------------------------------------------------------
    |
    | Searches:
    |
    | - Product name
    | - Product slug
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
| Public Category Visibility Stages
|--------------------------------------------------------------------------
|
| A Product is publicly visible only when:
|
| - Its selected Category exists.
| - Its Category is active.
| - Its Category is not deleted.
| - Every Category ancestor exists.
| - Every Category ancestor is active.
| - Every Category ancestor is not deleted.
|--------------------------------------------------------------------------
*/

const buildPublicCategoryVisibilityStages = () => {
  return [
    /*
      |--------------------------------------------------------------------------
      | Load Product Category
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: "categories",

        let: {
          categoryId: "$category",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$_id", "$$categoryId"],
              },
            },
          },

          {
            $match: {
              status: CATEGORY_STATUSES.ACTIVE,

              deletedAt: null,
            },
          },

          {
            $project: {
              _id: 1,
              name: 1,
              slug: 1,

              ancestors: {
                $ifNull: ["$ancestors", []],
              },
            },
          },
        ],

        as: "__publicCategory",
      },
    },

    /*
     * Removes Products whose selected Category
     * is missing, inactive, or deleted.
     */
    {
      $unwind: "$__publicCategory",
    },

    /*
      |--------------------------------------------------------------------------
      | Load Available Category Ancestors
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: "categories",

        let: {
          ancestorIds: "$__publicCategory.ancestors",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $in: ["$_id", "$$ancestorIds"],
              },
            },
          },

          {
            $match: {
              status: CATEGORY_STATUSES.ACTIVE,

              deletedAt: null,
            },
          },

          {
            $project: {
              _id: 1,
            },
          },
        ],

        as: "__publicCategoryAncestors",
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Verify Complete Ancestor Path
      |--------------------------------------------------------------------------
      |
      | If the Category stores three ancestor IDs,
      | exactly three available ancestors must be found.
      |--------------------------------------------------------------------------
      */

    {
      $match: {
        $expr: {
          $eq: [
            {
              $size: "$__publicCategoryAncestors",
            },

            {
              $size: "$__publicCategory.ancestors",
            },
          ],
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Populate Public Category Information
      |--------------------------------------------------------------------------
      */

    {
      $set: {
        category: {
          _id: "$__publicCategory._id",

          name: "$__publicCategory.name",

          slug: "$__publicCategory.slug",
        },
      },
    },
  ];
};

/*
|--------------------------------------------------------------------------
| Public Variant Calculation Stages
|--------------------------------------------------------------------------
*/

const buildPublicVariantCalculationStages = () => {
  return [
    /*
      |--------------------------------------------------------------------------
      | Select Active Variants
      |--------------------------------------------------------------------------
      |
      | A missing isActive value is treated as active
      | for compatibility with older Product documents.
      |--------------------------------------------------------------------------
      */

    {
      $set: {
        __activeVariants: {
          $filter: {
            input: {
              $ifNull: ["$variants", []],
            },

            as: "variant",

            cond: {
              $ne: ["$$variant.isActive", false],
            },
          },
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Calculate Variant Availability and Price
      |--------------------------------------------------------------------------
      */

    {
      $set: {
        __publicVariantMetrics: {
          $map: {
            input: "$__activeVariants",

            as: "variant",

            in: {
              availableStock: {
                $max: [
                  {
                    $subtract: [
                      {
                        $ifNull: ["$$variant.inventory.stock", 0],
                      },

                      {
                        $ifNull: ["$$variant.inventory.reservedStock", 0],
                      },
                    ],
                  },

                  0,
                ],
              },

              lowStockThreshold: {
                $ifNull: ["$$variant.inventory.lowStockThreshold", 0],
              },

              effectivePrice: {
                $ifNull: [
                  "$$variant.pricing.discountPrice",
                  "$$variant.pricing.sellingPrice",
                ],
              },

              currency: {
                $ifNull: ["$$variant.pricing.currency", "INR"],
              },
            },
          },
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Product-Level Availability and Price
      |--------------------------------------------------------------------------
      */

    {
      $set: {
        __availableStock: {
          $sum: "$__publicVariantMetrics.availableStock",
        },

        __minimumPrice: {
          $cond: [
            {
              $gt: [
                {
                  $size: "$__publicVariantMetrics",
                },
                0,
              ],
            },

            {
              $min: "$__publicVariantMetrics.effectivePrice",
            },

            null,
          ],
        },

        __maximumPrice: {
          $cond: [
            {
              $gt: [
                {
                  $size: "$__publicVariantMetrics",
                },
                0,
              ],
            },

            {
              $max: "$__publicVariantMetrics.effectivePrice",
            },

            null,
          ],
        },
      },
    },
  ];
};

/*
|--------------------------------------------------------------------------
| Public Stock Filter Stage
|--------------------------------------------------------------------------
*/

const buildPublicStockFilterStage = (inStock) => {
  if (inStock === undefined) {
    return null;
  }

  if (inStock) {
    return {
      $match: {
        __availableStock: {
          $gt: 0,
        },
      },
    };
  }

  return {
    $match: {
      __availableStock: 0,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Public Price Filter Stage
|--------------------------------------------------------------------------
|
| A Product matches when at least one active variant
| has an effective price inside the requested range.
|--------------------------------------------------------------------------
*/

const buildPublicPriceFilterStage = (minPrice, maxPrice) => {
  if (minPrice === undefined && maxPrice === undefined) {
    return null;
  }

  const priceConditions = [];

  if (minPrice !== undefined) {
    priceConditions.push({
      $gte: ["$$variantMetric.effectivePrice", minPrice],
    });
  }

  if (maxPrice !== undefined) {
    priceConditions.push({
      $lte: ["$$variantMetric.effectivePrice", maxPrice],
    });
  }

  return {
    $match: {
      $expr: {
        $gt: [
          {
            $size: {
              $filter: {
                input: "$__publicVariantMetrics",

                as: "variantMetric",

                cond:
                  priceConditions.length === 1
                    ? priceConditions[0]
                    : {
                        $and: priceConditions,
                      },
              },
            },
          },

          0,
        ],
      },
    },
  };
};

/*
|--------------------------------------------------------------------------
| Public Product Sorting
|--------------------------------------------------------------------------
*/

const buildPublicProductSort = (sort) => {
  switch (sort) {
    case "oldest":
      return {
        publishedAt: 1,
        _id: 1,
      };

    case "price-low-to-high":
      return {
        __minimumPrice: 1,
        name: 1,
        _id: 1,
      };

    case "price-high-to-low":
      return {
        __minimumPrice: -1,
        name: 1,
        _id: -1,
      };

    case "name-asc":
      return {
        name: 1,
        _id: 1,
      };

    case "name-desc":
      return {
        name: -1,
        _id: -1,
      };

    case "newest":
    default:
      return {
        publishedAt: -1,
        _id: -1,
      };
  }
};

/*
|--------------------------------------------------------------------------
| Remove Internal Aggregation Fields
|--------------------------------------------------------------------------
*/

const buildPublicProductCleanupStage = () => {
  return {
    $unset: [
      "__publicCategory",
      "__publicCategoryAncestors",
      "__activeVariants",
      "__publicVariantMetrics",
      "__availableStock",
      "__minimumPrice",
      "__maximumPrice",
    ],
  };
};

/*
|--------------------------------------------------------------------------
| List Public Products
|--------------------------------------------------------------------------
*/

export const listPublicProducts = async (filters) => {
  const {
    page = 1,
    limit = 20,
    inStock,
    minPrice,
    maxPrice,
    sort = "newest",
  } = filters;

  const skip = (page - 1) * limit;

  const pipeline = [
    /*
      |--------------------------------------------------------------------------
      | Active and Published Products
      |--------------------------------------------------------------------------
      */

    {
      $match: buildPublicProductMatchFilter(filters),
    },

    /*
      |--------------------------------------------------------------------------
      | Category Visibility
      |--------------------------------------------------------------------------
      */

    ...buildPublicCategoryVisibilityStages(),

    /*
      |--------------------------------------------------------------------------
      | Variant Availability and Prices
      |--------------------------------------------------------------------------
      */

    ...buildPublicVariantCalculationStages(),
  ];

  /*
    |--------------------------------------------------------------------------
    | Availability Filter
    |--------------------------------------------------------------------------
    */

  const stockFilterStage = buildPublicStockFilterStage(inStock);

  if (stockFilterStage) {
    pipeline.push(stockFilterStage);
  }

  /*
    |--------------------------------------------------------------------------
    | Price Filter
    |--------------------------------------------------------------------------
    */

  const priceFilterStage = buildPublicPriceFilterStage(minPrice, maxPrice);

  if (priceFilterStage) {
    pipeline.push(priceFilterStage);
  }

  /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

  pipeline.push({
    $facet: {
      products: [
        {
          $sort: buildPublicProductSort(sort),
        },

        {
          $skip: skip,
        },

        {
          $limit: limit,
        },

        buildPublicProductCleanupStage(),
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

/*
|--------------------------------------------------------------------------
| Find Public Product by Slug
|--------------------------------------------------------------------------
*/

export const findPublicProductBySlug = async (slug) => {
  const pipeline = [
    /*
      |--------------------------------------------------------------------------
      | Active, Published and Non-Deleted Product
      |--------------------------------------------------------------------------
      */

    {
      $match: {
        ...buildPublicProductMatchFilter(),

        slug,
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Validate and Populate Category Path
      |--------------------------------------------------------------------------
      */

    ...buildPublicCategoryVisibilityStages(),

    /*
      |--------------------------------------------------------------------------
      | Only One Product
      |--------------------------------------------------------------------------
      */

    {
      $limit: 1,
    },

    buildPublicProductCleanupStage(),
  ];

  const [product] = await Product.aggregate(pipeline);

  return product ?? null;
};

/*
|--------------------------------------------------------------------------
| Inventory Object ID Normalizer
|--------------------------------------------------------------------------
*/

const normalizeInventoryObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
};

/*
|--------------------------------------------------------------------------
| Variant Available Stock Expression
|--------------------------------------------------------------------------
|
| availableStock = stock - reservedStock
|--------------------------------------------------------------------------
*/

const buildVariantAvailableStockExpression = () => {
  return {
    $subtract: [
      {
        $ifNull: ["$$variant.inventory.stock", 0],
      },

      {
        $ifNull: ["$$variant.inventory.reservedStock", 0],
      },
    ],
  };
};

/*
|--------------------------------------------------------------------------
| Matching Variant Expression
|--------------------------------------------------------------------------
|
| Finds the requested variant and applies additional
| inventory conditions to that same array element.
|--------------------------------------------------------------------------
*/

const buildMatchingVariantExpression = (variantObjectId, conditions) => {
  return {
    $anyElementTrue: {
      $map: {
        input: {
          $ifNull: ["$variants", []],
        },

        as: "variant",

        in: {
          $and: [
            {
              $eq: ["$$variant._id", variantObjectId],
            },

            ...conditions,
          ],
        },
      },
    },
  };
};

/*
|--------------------------------------------------------------------------
| Atomic Variant Inventory Update
|--------------------------------------------------------------------------
|
| The inventory condition and inventory mutation happen
| inside one MongoDB findOneAndUpdate operation.
|--------------------------------------------------------------------------
*/

const updateVariantInventoryAtomically = async ({
  productId,
  variantId,
  actorUserId,
  productFilter = {},
  variantConditions,
  inventoryIncrement,
  session,
}) => {
  const productObjectId = normalizeInventoryObjectId(productId);

  const variantObjectId = normalizeInventoryObjectId(variantId);

  const updatedAt = new Date();

  return Product.findOneAndUpdate(
    {
      _id: productObjectId,

      deletedAt: null,

      /*
       * Helps MongoDB quickly reject Products
       * that do not contain the requested variant.
       */
      "variants._id": variantObjectId,

      ...productFilter,

      /*
       * Ensures the stock condition is evaluated
       * against the requested variant.
       */
      $expr: buildMatchingVariantExpression(variantObjectId, variantConditions),
    },

    {
      $inc: inventoryIncrement,

      $set: {
        updatedBy: actorUserId,

        updatedAt,
      },
    },

    {
      new: true,

      arrayFilters: [
        {
          "variant._id": variantObjectId,
        },
      ],

      /*
       * Cross-field inventory safety is enforced by
       * the atomic query conditions rather than normal
       * Mongoose update validators.
       */
      runValidators: false,

      /*
       * Allows Product mutation and ledger creation
       * to participate in the same transaction.
       */
      session,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Find Product Variant Inventory Snapshot
|--------------------------------------------------------------------------
*/

export const findProductVariantInventorySnapshot = async (
  productId,
  variantId,
  { session } = {},
) => {
  const productObjectId = normalizeInventoryObjectId(productId);

  const variantObjectId = normalizeInventoryObjectId(variantId);

  const productQuery = Product.findById(productObjectId)
    .select({
      status: 1,
      deletedAt: 1,

      "variants._id": 1,
      "variants.sku": 1,
      "variants.isActive": 1,
      "variants.inventory": 1,
    })
    .lean();

  if (session) {
    productQuery.session(session);
  }

  const product = await productQuery;

  if (!product) {
    return null;
  }

  const variant = (product.variants ?? []).find((item) => {
    return String(item._id) === String(variantObjectId);
  });

  if (!variant) {
    return {
      productId: String(product._id),

      status: product.status,

      isDeleted: Boolean(product.deletedAt),

      variant: null,
    };
  }

  const stock = variant.inventory?.stock ?? 0;

  const reservedStock = variant.inventory?.reservedStock ?? 0;

  return {
    productId: String(product._id),

    status: product.status,

    isDeleted: Boolean(product.deletedAt),

    variant: {
      id: String(variant._id),

      isActive: variant.isActive !== false,

      stock,

      reservedStock,

      availableStock: Math.max(stock - reservedStock, 0),

      lowStockThreshold: variant.inventory?.lowStockThreshold ?? 0,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Adjust Variant Physical Stock Atomically
|--------------------------------------------------------------------------
|
| stock = stock + quantityDelta
|
| The resulting physical stock must remain greater
| than or equal to reservedStock.
|--------------------------------------------------------------------------
*/

export const adjustVariantStockAtomically = async ({
  productId,
  variantId,
  quantityDelta,
  actorUserId,
  session,
}) => {
  return updateVariantInventoryAtomically({
    productId,
    variantId,
    actorUserId,
    session,

    variantConditions: [
      {
        $gte: [
          /*
           * Resulting physical stock.
           */
          {
            $add: [
              {
                $ifNull: ["$$variant.inventory.stock", 0],
              },

              quantityDelta,
            ],
          },

          /*
           * Existing reserved units must
           * remain physically available.
           */
          {
            $ifNull: ["$$variant.inventory.reservedStock", 0],
          },
        ],
      },
    ],

    inventoryIncrement: {
      "variants.$[variant].inventory.stock": quantityDelta,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Reserve Variant Stock Atomically
|--------------------------------------------------------------------------
|
| reservedStock = reservedStock + quantity
|
| Only an active Product and active variant can accept
| a new reservation.
|--------------------------------------------------------------------------
*/

export const reserveVariantStockAtomically = async ({
  productId,
  variantId,
  quantity,
  actorUserId,
  session,
}) => {
  return updateVariantInventoryAtomically({
    productId,
    variantId,
    actorUserId,
    session,

    productFilter: {
      status: PRODUCT_STATUSES.ACTIVE,
    },

    variantConditions: [
      /*
       * Missing isActive is treated as active
       * for compatibility with older documents.
       */
      {
        $ne: ["$$variant.isActive", false],
      },

      /*
       * availableStock >= requested quantity
       */
      {
        $gte: [buildVariantAvailableStockExpression(), quantity],
      },
    ],

    inventoryIncrement: {
      "variants.$[variant].inventory.reservedStock": quantity,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Release Variant Reservation Atomically
|--------------------------------------------------------------------------
|
| reservedStock = reservedStock - quantity
|
| Release does not require the Product or variant to
| remain active because an existing order may need to
| release stock after catalogue status changes.
|--------------------------------------------------------------------------
*/

export const releaseVariantStockAtomically = async ({
  productId,
  variantId,
  quantity,
  actorUserId,
  session,
}) => {
  return updateVariantInventoryAtomically({
    productId,
    variantId,
    actorUserId,
    session,

    variantConditions: [
      /*
       * Cannot release more than the
       * currently reserved quantity.
       */
      {
        $gte: [
          {
            $ifNull: ["$$variant.inventory.reservedStock", 0],
          },

          quantity,
        ],
      },
    ],

    inventoryIncrement: {
      "variants.$[variant].inventory.reservedStock": -quantity,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Commit Reserved Variant Stock Atomically
|--------------------------------------------------------------------------
|
| Used after a purchase is completed.
|
| stock         = stock - quantity
| reservedStock = reservedStock - quantity
|--------------------------------------------------------------------------
*/

export const commitVariantStockAtomically = async ({
  productId,
  variantId,
  quantity,
  actorUserId,
  session,
}) => {
  return updateVariantInventoryAtomically({
    productId,
    variantId,
    actorUserId,
    session,

    variantConditions: [
      /*
       * The requested quantity must still
       * exist in reserved stock.
       */
      {
        $gte: [
          {
            $ifNull: ["$$variant.inventory.reservedStock", 0],
          },

          quantity,
        ],
      },

      /*
       * Defensive physical-stock check.
       */
      {
        $gte: [
          {
            $ifNull: ["$$variant.inventory.stock", 0],
          },

          quantity,
        ],
      },
    ],

    inventoryIncrement: {
      "variants.$[variant].inventory.stock": -quantity,

      "variants.$[variant].inventory.reservedStock": -quantity,
    },
  });
};
