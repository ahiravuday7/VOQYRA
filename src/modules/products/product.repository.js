import mongoose from "mongoose";
import { CATEGORY_STATUSES } from "../../shared/constants/category.constants.js";
import { PRODUCT_STATUSES } from "../../shared/constants/product.constants.js";
import Product from "./product.model.js";

import { BRAND_STATUSES } from "../../shared/constants/brand.constants.js";

import { SIZE_GUIDE_STATUSES } from "../../shared/constants/size-guide.constants.js";

import { COLLECTION_STATUSES } from "../../shared/constants/collection.constants.js";

import Brand from "../brands/brand.model.js";
import SizeGuide from "../size-guides/size-guide.model.js";
import Collection from "../collections/collection.model.js";

/*
|--------------------------------------------------------------------------
| Apply Product Master-Data Filters
|--------------------------------------------------------------------------
*/

const applyProductMasterDataFilters = (
  filter,
  { category, brand, sizeGuide, collection } = {},
) => {
  if (category) {
    filter.category = new mongoose.Types.ObjectId(category);
  }

  if (brand) {
    filter.brand = new mongoose.Types.ObjectId(brand);
  }

  if (sizeGuide) {
    filter.sizeGuide = new mongoose.Types.ObjectId(sizeGuide);
  }

  if (collection) {
    /*
     * Product.collections is an array.
     *
     * Matching one ObjectId automatically checks
     * whether that ObjectId exists in the array.
     */
    filter.collections = new mongoose.Types.ObjectId(collection);
  }

  return filter;
};

/*
|--------------------------------------------------------------------------
| Product Master-Data Population
|--------------------------------------------------------------------------
*/

const populateProductMasterData = (query) => {
  return query
    .populate({
      path: "brand",

      select: "_id name slug logo status deletedAt",
    })
    .populate({
      path: "sizeGuide",

      select: "_id name slug unit status deletedAt",
    })
    .populate({
      path: "collections",

      select: "_id name slug banner status isFeatured sortOrder deletedAt",

      options: {
        sort: {
          sortOrder: 1,
          name: 1,
        },
      },
    });
};

/*
|--------------------------------------------------------------------------
| Find Product by ID
|--------------------------------------------------------------------------
*/

export const findProductById = (productId, options = {}) => {
  const {
    session = null,

    includeDeleted = false,

    populateMasterData = false,
  } = options;

  const filter = {
    _id: productId,
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  let query = Product.findOne(filter);

  if (populateMasterData) {
    query = populateProductMasterData(query);
  }

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Admin Product with Master Data
|--------------------------------------------------------------------------
*/

export const findAdminProductById = (productId, options = {}) => {
  return findProductById(productId, {
    ...options,

    populateMasterData: true,
  });
};

/*
|--------------------------------------------------------------------------
| Find Product IDs by Brand IDs
|--------------------------------------------------------------------------
*/

export const findProductIdsByBrandIds = async (brandIds, options = {}) => {
  const { includeDeleted = false } = options;

  if (!Array.isArray(brandIds) || brandIds.length === 0) {
    return [];
  }

  const filter = {
    brand: {
      $in: brandIds,
    },
  };

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  const products = await Product.find(filter).select("_id").lean();

  return products.map((product) => product._id);
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
| Product Search Stage
|--------------------------------------------------------------------------
|
| Must run AFTER Brand has been populated.
|--------------------------------------------------------------------------
*/

const buildProductSearchStage = (search) => {
  if (!search) {
    return null;
  }

  const escapedSearch = escapeRegularExpression(search);

  const searchExpression = new RegExp(escapedSearch, "i");

  return {
    $match: {
      $or: [
        {
          name: searchExpression,
        },

        {
          slug: searchExpression,
        },

        {
          tags: searchExpression,
        },

        {
          "variants.sku": searchExpression,
        },

        /*
         * Brand master-data search.
         */
        {
          "brand.name": searchExpression,
        },

        {
          "brand.slug": searchExpression,
        },
      ],
    },
  };
};

/*
|--------------------------------------------------------------------------
| Admin Product Master-Data Population
|--------------------------------------------------------------------------
*/

const buildAdminProductMasterDataStages = () => {
  return [
    /*
      |--------------------------------------------------------------------------
      | Brand
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: Brand.collection.name,

        localField: "brand",

        foreignField: "_id",

        as: "__adminBrand",
      },
    },

    {
      $set: {
        brand: {
          $ifNull: [
            {
              $arrayElemAt: ["$__adminBrand", 0],
            },

            /*
             * Preserve the raw reference if
             * the Brand no longer exists.
             */
            "$brand",
          ],
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | SizeGuide
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: SizeGuide.collection.name,

        localField: "sizeGuide",

        foreignField: "_id",

        as: "__adminSizeGuide",
      },
    },

    {
      $set: {
        sizeGuide: {
          $ifNull: [
            {
              $arrayElemAt: ["$__adminSizeGuide", 0],
            },

            "$sizeGuide",
          ],
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Collections
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: Collection.collection.name,

        localField: "collections",

        foreignField: "_id",

        as: "collections",
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Cleanup
      |--------------------------------------------------------------------------
      */

    {
      $unset: ["__adminBrand", "__adminSizeGuide"],
    },
  ];
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
| Master Data Filters
|--------------------------------------------------------------------------
*/

  applyProductMasterDataFilters(match, {
    category: filters.category,

    brand: filters.brand,

    sizeGuide: filters.sizeGuide,

    collection: filters.collection,
  });

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
  |--------------------------------------------------------------------------
  | Normalize Sorting
  |--------------------------------------------------------------------------
  */

  const normalizedSortBy = ADMIN_PRODUCT_SORT_FIELDS.has(sortBy)
    ? sortBy
    : "createdAt";

  const normalizedSortDirection = sortDirection === "asc" ? 1 : -1;

  /*
  |--------------------------------------------------------------------------
  | Brand Sorting
  |--------------------------------------------------------------------------
  |
  | Product.brand is now an ObjectId.
  |
  | Sorting directly by:
  |
  | brand
  |
  | would sort MongoDB ObjectIds.
  |
  | Instead:
  |
  | sortBy=brand
  |
  | means:
  |
  | brand.name
  |--------------------------------------------------------------------------
  */

  const normalizedSortField =
    normalizedSortBy === "brand" ? "brand.name" : normalizedSortBy;

  /*
  |--------------------------------------------------------------------------
  | Build Filters
  |--------------------------------------------------------------------------
  */

  const matchFilter = buildAdminProductMatchFilter(filters);

  const stockStatusStage = buildStockStatusStage(stockStatus);

  const searchStage = buildProductSearchStage(filters.search);

  /*
  |--------------------------------------------------------------------------
  | Build Pipeline
  |--------------------------------------------------------------------------
  */

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
    | Populate Brand / SizeGuide / Collections
    |--------------------------------------------------------------------------
    |
    | This must happen before:
    |
    | - Brand-name searching
    | - Brand-name sorting
    |--------------------------------------------------------------------------
    */

    ...buildAdminProductMasterDataStages(),
  ];

  /*
  |--------------------------------------------------------------------------
  | Product + Brand Search
  |--------------------------------------------------------------------------
  */

  if (searchStage) {
    pipeline.push(searchStage);
  }

  /*
  |--------------------------------------------------------------------------
  | Calculate Active Variant Stock
  |--------------------------------------------------------------------------
  */

  pipeline.push(buildActiveVariantStockStage());

  /*
  |--------------------------------------------------------------------------
  | Apply Stock Status Filter
  |--------------------------------------------------------------------------
  */

  if (stockStatusStage) {
    pipeline.push(stockStatusStage);
  }

  /*
  |--------------------------------------------------------------------------
  | Pagination + Count
  |--------------------------------------------------------------------------
  */

  pipeline.push({
    $facet: {
      products: [
        /*
        |--------------------------------------------------------------------------
        | Sorting
        |--------------------------------------------------------------------------
        */

        {
          $sort: {
            [normalizedSortField]: normalizedSortDirection,

            /*
             * Stable sorting.
             */
            _id: normalizedSortDirection,
          },
        },

        /*
        |--------------------------------------------------------------------------
        | Pagination
        |--------------------------------------------------------------------------
        */

        {
          $skip: skip,
        },

        {
          $limit: limit,
        },

        /*
        |--------------------------------------------------------------------------
        | Remove Internal Fields
        |--------------------------------------------------------------------------
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

  /*
  |--------------------------------------------------------------------------
  | Execute
  |--------------------------------------------------------------------------
  */

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
| Master Data Filters
|--------------------------------------------------------------------------
|
| Public storefront supports:
|
| Category
| Brand
| Collection
|
| SizeGuide is intentionally admin-only.
|--------------------------------------------------------------------------
*/

  applyProductMasterDataFilters(match, {
    category: filters.category,

    brand: filters.brand,

    collection: filters.collection,
  });

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
| Public Brand Visibility
|--------------------------------------------------------------------------
|
| Public Product requires:
|
| Brand exists
| Brand active
| Brand not deleted
|--------------------------------------------------------------------------
*/

const buildPublicBrandVisibilityStages = () => {
  return [
    {
      $lookup: {
        from: Brand.collection.name,

        let: {
          brandId: "$brand",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$_id", "$$brandId"],
              },
            },
          },

          {
            $match: {
              status: BRAND_STATUSES.ACTIVE,

              deletedAt: null,
            },
          },

          {
            $project: {
              _id: 1,

              name: 1,

              slug: 1,

              logo: 1,
            },
          },
        ],

        as: "__publicBrand",
      },
    },

    /*
     * Missing / inactive / deleted Brand
     * removes the Product.
     */
    {
      $unwind: "$__publicBrand",
    },

    {
      $set: {
        brand: "$__publicBrand",
      },
    },
  ];
};

/*
|--------------------------------------------------------------------------
| Public Supplemental Master Data
|--------------------------------------------------------------------------
*/

const buildPublicSupplementalMasterDataStages = () => {
  return [
    /*
      |--------------------------------------------------------------------------
      | Size Guide
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: SizeGuide.collection.name,

        let: {
          sizeGuideId: "$sizeGuide",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$_id", "$$sizeGuideId"],
              },
            },
          },

          {
            $match: {
              status: SIZE_GUIDE_STATUSES.ACTIVE,

              deletedAt: null,
            },
          },

          {
            $project: {
              _id: 1,

              name: 1,

              slug: 1,

              unit: 1,
            },
          },
        ],

        as: "__publicSizeGuide",
      },
    },

    {
      $match: {
        $expr: {
          $or: [
            /*
             * Product does not use a SizeGuide.
             */
            {
              $eq: [
                {
                  $ifNull: ["$sizeGuide", null],
                },

                null,
              ],
            },

            /*
             * Product references a valid,
             * active SizeGuide.
             */
            {
              $eq: [
                {
                  $size: "$__publicSizeGuide",
                },

                1,
              ],
            },
          ],
        },
      },
    },

    {
      $set: {
        sizeGuide: {
          $ifNull: [
            {
              $arrayElemAt: ["$__publicSizeGuide", 0],
            },

            null,
          ],
        },
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Collections
      |--------------------------------------------------------------------------
      |
      | Only active, non-deleted Collections are
      | exposed publicly.
      |--------------------------------------------------------------------------
      */

    {
      $lookup: {
        from: Collection.collection.name,

        let: {
          collectionIds: {
            $ifNull: ["$collections", []],
          },
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $in: ["$_id", "$$collectionIds"],
              },
            },
          },

          {
            $match: {
              status: COLLECTION_STATUSES.ACTIVE,

              deletedAt: null,
            },
          },

          {
            $project: {
              _id: 1,

              name: 1,

              slug: 1,

              banner: 1,

              isFeatured: 1,

              sortOrder: 1,
            },
          },

          {
            $sort: {
              sortOrder: 1,

              name: 1,
            },
          },
        ],

        as: "collections",
      },
    },
  ];
};

const buildPublicCollectionVerificationStage = (collectionId) => {
  if (!collectionId) {
    return null;
  }

  return {
    $match: {
      "collections._id": new mongoose.Types.ObjectId(collectionId),
    },
  };
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

      "__publicBrand",

      "__publicSizeGuide",

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

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  |
  | Search must run after Brand population
  | because Product.brand is now an ObjectId.
  |--------------------------------------------------------------------------
  */

  const searchStage = buildProductSearchStage(filters.search);

  /*
  |--------------------------------------------------------------------------
  | Public Collection Verification
  |--------------------------------------------------------------------------
  |
  | Product may internally reference an inactive Collection.
  |
  | The Product itself remains public,
  | but filtering by that inactive Collection must not return it.
  |--------------------------------------------------------------------------
  */

  const collectionVerificationStage = buildPublicCollectionVerificationStage(
    filters.collection,
  );

  /*
  |--------------------------------------------------------------------------
  | Base Pipeline
  |--------------------------------------------------------------------------
  */

  const pipeline = [
    /*
    |--------------------------------------------------------------------------
    | Active / Published Products
    |--------------------------------------------------------------------------
    */

    {
      $match: buildPublicProductMatchFilter(filters),
    },

    /*
    |--------------------------------------------------------------------------
    | Brand Visibility
    |--------------------------------------------------------------------------
    |
    | Requires:
    |
    | - Brand exists
    | - Brand active
    | - Brand not deleted
    |
    | This also populates Product.brand.
    |--------------------------------------------------------------------------
    */

    ...buildPublicBrandVisibilityStages(),
  ];

  /*
  |--------------------------------------------------------------------------
  | Product / Brand Search
  |--------------------------------------------------------------------------
  */

  if (searchStage) {
    pipeline.push(searchStage);
  }

  /*
  |--------------------------------------------------------------------------
  | Category Visibility
  |--------------------------------------------------------------------------
  |
  | Requires:
  |
  | - Category exists
  | - Category active
  | - Category not deleted
  | - All ancestors available
  |--------------------------------------------------------------------------
  */

  pipeline.push(...buildPublicCategoryVisibilityStages());

  /*
  |--------------------------------------------------------------------------
  | SizeGuide + Collections
  |--------------------------------------------------------------------------
  |
  | SizeGuide:
  | Only active/non-deleted data is populated.
  |
  | Collections:
  | Only active/non-deleted Collections are returned.
  |--------------------------------------------------------------------------
  */

  pipeline.push(...buildPublicSupplementalMasterDataStages());

  /*
  |--------------------------------------------------------------------------
  | Verify Requested Collection
  |--------------------------------------------------------------------------
  |
  | Important:
  |
  | This happens after active Collections
  | have been populated.
  |--------------------------------------------------------------------------
  */

  if (collectionVerificationStage) {
    pipeline.push(collectionVerificationStage);
  }

  /*
  |--------------------------------------------------------------------------
  | Variant Availability + Pricing
  |--------------------------------------------------------------------------
  */

  pipeline.push(...buildPublicVariantCalculationStages());

  /*
  |--------------------------------------------------------------------------
  | Stock Filter
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
        /*
        |--------------------------------------------------------------------------
        | Sorting
        |--------------------------------------------------------------------------
        */

        {
          $sort: buildPublicProductSort(sort),
        },

        /*
        |--------------------------------------------------------------------------
        | Pagination
        |--------------------------------------------------------------------------
        */

        {
          $skip: skip,
        },

        {
          $limit: limit,
        },

        /*
        |--------------------------------------------------------------------------
        | Remove Internal Aggregation Fields
        |--------------------------------------------------------------------------
        */

        buildPublicProductCleanupStage(),
      ],

      metadata: [
        {
          $count: "totalItems",
        },
      ],
    },
  });

  /*
  |--------------------------------------------------------------------------
  | Execute
  |--------------------------------------------------------------------------
  */

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
      | Product Availability
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
      | Brand Visibility
      |--------------------------------------------------------------------------
      */

    ...buildPublicBrandVisibilityStages(),

    /*
      |--------------------------------------------------------------------------
      | Category Visibility
      |--------------------------------------------------------------------------
      */

    ...buildPublicCategoryVisibilityStages(),

    /*
      |--------------------------------------------------------------------------
      | SizeGuide + Collections
      |--------------------------------------------------------------------------
      */

    ...buildPublicSupplementalMasterDataStages(),

    /*
      |--------------------------------------------------------------------------
      | Only One
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
| Normalize Checkout Product IDs
|--------------------------------------------------------------------------
*/

const normalizeCheckoutProductIds = (productIds) => {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return [];
  }

  /*
   * Convert to strings before using Set.
   *
   * Different ObjectId instances containing the same
   * value are different JavaScript object references.
   */
  const uniqueProductIds = [
    ...new Set(
      productIds.map((productId) => {
        return String(productId);
      }),
    ),
  ];

  return uniqueProductIds.map((productId) => {
    return new mongoose.Types.ObjectId(productId);
  });
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
| Release Order Variant Reservation Atomically
|--------------------------------------------------------------------------
|
| User operation:
|   actorUserId exists
|   → update Product.updatedBy
|
| System operation:
|   actorUserId = null
|   → preserve the previous real human updatedBy value
|--------------------------------------------------------------------------
*/

export const releaseOrderVariantStockAtomically = async ({
  productId,

  variantId,

  quantity,

  actorUserId = null,

  session,
}) => {
  const normalizedProductId = normalizeInventoryObjectId(productId);

  const normalizedVariantId = normalizeInventoryObjectId(variantId);

  const update = {
    $inc: {
      "variants.$.inventory.reservedStock": -quantity,
    },
  };

  /*
  |--------------------------------------------------------------------------
  | Human Audit Compatibility
  |--------------------------------------------------------------------------
  */

  if (actorUserId) {
    update.$set = {
      updatedBy: actorUserId,
    };
  }

  return Product.findOneAndUpdate(
    {
      _id: normalizedProductId,

      variants: {
        $elemMatch: {
          _id: normalizedVariantId,

          "inventory.reservedStock": {
            $gte: quantity,
          },
        },
      },
    },

    update,

    {
      returnDocument: "after",

      runValidators: true,

      session,
    },
  );
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

/*
|--------------------------------------------------------------------------
| Commit Order Variant Reservation Atomically
|--------------------------------------------------------------------------
|
| Confirmation converts reserved inventory into a completed stock movement.
|
| Example:
|
| Before:
| stock         = 10
| reservedStock = 2
| available     = 8
|
| Commit 2:
|
| After:
| stock         = 8
| reservedStock = 0
| available     = 8
|
| Existing Orders may still be confirmed even if the Product or variant was
| made inactive after checkout. Therefore, this query does not require public
| Product visibility or an active Product lifecycle state.
|--------------------------------------------------------------------------
*/

export const commitOrderVariantStockAtomically = async ({
  productId,
  variantId,
  quantity,
  actorUserId,
  session,
}) => {
  const normalizedProductId = normalizeInventoryObjectId(productId);

  const normalizedVariantId = normalizeInventoryObjectId(variantId);

  return Product.findOneAndUpdate(
    {
      _id: normalizedProductId,

      variants: {
        $elemMatch: {
          _id: normalizedVariantId,

          "inventory.stock": {
            $gte: quantity,
          },

          "inventory.reservedStock": {
            $gte: quantity,
          },
        },
      },
    },

    {
      $inc: {
        "variants.$.inventory.stock": -quantity,

        "variants.$.inventory.reservedStock": -quantity,
      },

      $set: {
        updatedBy: actorUserId,
      },
    },

    {
      new: true,

      runValidators: true,

      session,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Find Products for Checkout
|--------------------------------------------------------------------------
|
| Loads all requested Products in one aggregation query.
|
| A Product is returned only when:
|
| - It is active.
| - It is published.
| - It is not deleted.
| - Its selected Category is active and not deleted.
| - Every Category ancestor is active and not deleted.
|
| All variants are returned intentionally.
|
| The Order service must determine whether the specifically
| requested variant exists and is active.
|--------------------------------------------------------------------------
*/

export const findProductsForCheckout = async (
  productIds,
  { session = null } = {},
) => {
  const normalizedProductIds = normalizeCheckoutProductIds(productIds);

  if (normalizedProductIds.length === 0) {
    return [];
  }

  const pipeline = [
    /*
      |--------------------------------------------------------------------------
      | Requested Publicly Available Products
      |--------------------------------------------------------------------------
      */

    {
      $match: {
        ...buildPublicProductMatchFilter(),

        _id: {
          $in: normalizedProductIds,
        },
      },
    },

    /*
|--------------------------------------------------------------------------
| Brand Availability
|--------------------------------------------------------------------------
*/

    ...buildPublicBrandVisibilityStages(),

    /*
|--------------------------------------------------------------------------
| Category Availability
|--------------------------------------------------------------------------
*/

    ...buildPublicCategoryVisibilityStages(),

    /*
      |--------------------------------------------------------------------------
      | Checkout Snapshot Projection
      |--------------------------------------------------------------------------
      |
      | Do not expose buyingPrice to the Order service.
      |--------------------------------------------------------------------------
      */

    {
      $project: {
        _id: 1,

        name: 1,
        slug: 1,

        category: {
          _id: 1,
          name: 1,
          slug: 1,
        },

        images: {
          _id: 1,
          url: 1,
          altText: 1,
          sortOrder: 1,
          isPrimary: 1,
        },

        variants: {
          _id: 1,
          sku: 1,
          size: 1,
          color: 1,
          isActive: 1,

          pricing: {
            sellingPrice: 1,
            discountPrice: 1,
            currency: 1,
          },

          inventory: {
            stock: 1,
            reservedStock: 1,
            lowStockThreshold: 1,
          },
        },
      },
    },
  ];

  const aggregation = Product.aggregate(pipeline);

  if (session) {
    aggregation.session(session);
  }

  return aggregation;
};
