import mongoose from "mongoose";

import {
  PRODUCT_CURRENCIES,
  PRODUCT_CURRENCY_VALUES,
  PRODUCT_LIMITS,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_VALUES,
} from "../../shared/constants/product.constants.js";

const { Schema, model } = mongoose;

/*
|--------------------------------------------------------------------------
| String Array Normalizer
|--------------------------------------------------------------------------
*/

const normalizeStringArray = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => {
          return typeof value === "string" ? value.trim() : "";
        })
        .filter(Boolean),
    ),
  ];
};

/*
|--------------------------------------------------------------------------
| Product Image Schema
|--------------------------------------------------------------------------
*/

const productImageSchema = new Schema(
  {
    url: {
      type: String,
      required: [true, "Product image URL is required"],
      trim: true,
      maxlength: [2048, "Product image URL cannot exceed 2048 characters"],
    },

    publicId: {
      type: String,
      trim: true,
      maxlength: [300, "Product image public ID cannot exceed 300 characters"],
      default: "",
    },

    altText: {
      type: String,
      trim: true,
      maxlength: [150, "Product image alt text cannot exceed 150 characters"],
      default: "",
    },

    sortOrder: {
      type: Number,
      min: [0, "Image sort order cannot be negative"],
      default: 0,
    },

    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: true,
  },
);

/*
|--------------------------------------------------------------------------
| Product Colour Schema
|--------------------------------------------------------------------------
*/

const productColorSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Variant colour name is required"],
      trim: true,
      maxlength: [50, "Variant colour name cannot exceed 50 characters"],
    },

    code: {
      type: String,
      required: [true, "Variant colour code is required"],
      trim: true,
      uppercase: true,

      match: [
        /^#[0-9A-F]{6}$/,
        "Variant colour code must use the format #RRGGBB",
      ],
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Variant Pricing Schema
|--------------------------------------------------------------------------
*/

const variantPricingSchema = new Schema(
  {
    buyingPrice: {
      type: Number,
      required: [true, "Variant buying price is required"],
      min: [0, "Buying price cannot be negative"],
    },

    sellingPrice: {
      type: Number,
      required: [true, "Variant selling price is required"],
      min: [0, "Selling price cannot be negative"],
    },

    discountPrice: {
      type: Number,
      default: null,

      validate: {
        validator(value) {
          if (value === null || value === undefined) {
            return true;
          }

          return value >= 0 && value <= this.sellingPrice;
        },

        message: "Discount price must be between zero and the selling price",
      },
    },

    currency: {
      type: String,

      enum: {
        values: PRODUCT_CURRENCY_VALUES,

        message: "Unsupported product currency",
      },

      default: PRODUCT_CURRENCIES.INR,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Variant Inventory Schema
|--------------------------------------------------------------------------
*/

const variantInventorySchema = new Schema(
  {
    stock: {
      type: Number,
      min: [0, "Variant stock cannot be negative"],
      default: 0,
    },

    reservedStock: {
      type: Number,
      min: [0, "Reserved stock cannot be negative"],
      default: 0,

      validate: {
        validator(value) {
          return value <= this.stock;
        },

        message: "Reserved stock cannot exceed total stock",
      },
    },

    lowStockThreshold: {
      type: Number,
      min: [0, "Low-stock threshold cannot be negative"],
      default: 5,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Package Dimensions Schema
|--------------------------------------------------------------------------
*/

const packageDimensionsSchema = new Schema(
  {
    lengthCm: {
      type: Number,
      min: [0, "Package length cannot be negative"],
      default: 0,
    },

    widthCm: {
      type: Number,
      min: [0, "Package width cannot be negative"],
      default: 0,
    },

    heightCm: {
      type: Number,
      min: [0, "Package height cannot be negative"],
      default: 0,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Variant Shipping Schema
|--------------------------------------------------------------------------
*/

const variantShippingSchema = new Schema(
  {
    weightInGrams: {
      type: Number,
      min: [0, "Variant weight cannot be negative"],
      default: 0,
    },

    dimensions: {
      type: packageDimensionsSchema,

      default: () => ({}),
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Product Variant Schema
|--------------------------------------------------------------------------
*/

const productVariantSchema = new Schema(
  {
    sku: {
      type: String,
      required: [true, "Variant SKU is required"],
      trim: true,
      uppercase: true,

      minlength: [3, "Variant SKU must contain at least 3 characters"],

      maxlength: [100, "Variant SKU cannot exceed 100 characters"],

      match: [
        /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
        "Variant SKU can contain uppercase letters, numbers and hyphens only",
      ],
    },

    barcode: {
      type: String,
      trim: true,
      maxlength: [100, "Variant barcode cannot exceed 100 characters"],
      default: "",
    },

    size: {
      type: String,
      required: [true, "Variant size is required"],
      trim: true,
      maxlength: [30, "Variant size cannot exceed 30 characters"],
    },

    color: {
      type: productColorSchema,
      required: [true, "Variant colour is required"],
    },

    pricing: {
      type: variantPricingSchema,
      required: [true, "Variant pricing is required"],
    },

    inventory: {
      type: variantInventorySchema,

      default: () => ({}),
    },

    shipping: {
      type: variantShippingSchema,

      default: () => ({}),
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: true,

    toJSON: {
      virtuals: true,
    },

    toObject: {
      virtuals: true,
    },
  },
);

/*
|--------------------------------------------------------------------------
| Variant Virtual Fields
|--------------------------------------------------------------------------
*/

productVariantSchema.virtual("effectivePrice").get(function () {
  return this.pricing?.discountPrice ?? this.pricing?.sellingPrice ?? 0;
});

productVariantSchema.virtual("availableStock").get(function () {
  const stock = this.inventory?.stock ?? 0;

  const reservedStock = this.inventory?.reservedStock ?? 0;

  return Math.max(stock - reservedStock, 0);
});

productVariantSchema.virtual("isLowStock").get(function () {
  const availableStock = Math.max(
    (this.inventory?.stock ?? 0) - (this.inventory?.reservedStock ?? 0),
    0,
  );

  return availableStock <= (this.inventory?.lowStockThreshold ?? 0);
});

/*
|--------------------------------------------------------------------------
| Product Attribute Schema
|--------------------------------------------------------------------------
|
| Examples:
|
| Material → Cotton
| Pattern  → Solid
| Fit      → Regular
| Sleeve   → Half Sleeve
|--------------------------------------------------------------------------
*/

const productAttributeSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Product attribute name is required"],
      trim: true,
      maxlength: [80, "Product attribute name cannot exceed 80 characters"],
    },

    value: {
      type: String,
      required: [true, "Product attribute value is required"],
      trim: true,
      maxlength: [200, "Product attribute value cannot exceed 200 characters"],
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Product SEO Schema
|--------------------------------------------------------------------------
*/

const productSeoSchema = new Schema(
  {
    metaTitle: {
      type: String,
      trim: true,
      maxlength: [70, "SEO title cannot exceed 70 characters"],
      default: "",
    },

    metaDescription: {
      type: String,
      trim: true,
      maxlength: [170, "SEO description cannot exceed 170 characters"],
      default: "",
    },

    keywords: {
      type: [
        {
          type: String,
          trim: true,
          lowercase: true,
        },
      ],

      set: normalizeStringArray,

      validate: {
        validator(values) {
          return values.length <= PRODUCT_LIMITS.MAX_TAGS;
        },

        message: "SEO keywords cannot contain more than 20 values",
      },

      default: [],
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Product Schema
|--------------------------------------------------------------------------
*/

const productSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,

      minlength: [3, "Product name must contain at least 3 characters"],

      maxlength: [200, "Product name cannot exceed 200 characters"],
    },

    slug: {
      type: String,
      required: [true, "Product slug is required"],
      trim: true,
      lowercase: true,

      minlength: [3, "Product slug must contain at least 3 characters"],

      maxlength: [220, "Product slug cannot exceed 220 characters"],

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Product slug can contain lowercase letters, numbers and hyphens only",
      ],
    },

    shortDescription: {
      type: String,
      trim: true,
      maxlength: [
        300,
        "Product short description cannot exceed 300 characters",
      ],
      default: "",
    },

    description: {
      type: String,
      trim: true,
      maxlength: [5000, "Product description cannot exceed 5000 characters"],
      default: "",
    },

    /*
     * Store the most-specific category.
     *
     * Example:
     * Men → Topwear → T-Shirts
     *
     * Product category:
     * T-Shirts
     */
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",

      required: [true, "Product category is required"],

      index: true,
    },

    brand: {
      type: String,
      required: [true, "Product brand is required"],
      trim: true,

      maxlength: [100, "Product brand cannot exceed 100 characters"],
    },

    attributes: {
      type: [productAttributeSchema],

      validate: {
        validator(values) {
          return values.length <= PRODUCT_LIMITS.MAX_ATTRIBUTES;
        },

        message: "Product cannot contain more than 30 attributes",
      },

      default: [],
    },

    materials: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],

      set: normalizeStringArray,

      default: [],
    },

    careInstructions: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],

      set: normalizeStringArray,

      validate: {
        validator(values) {
          return values.length <= PRODUCT_LIMITS.MAX_CARE_INSTRUCTIONS;
        },

        message: "Product cannot contain more than 20 care instructions",
      },

      default: [],
    },

    countryOfOrigin: {
      type: String,
      trim: true,

      maxlength: [100, "Country of origin cannot exceed 100 characters"],

      default: "India",
    },

    tags: {
      type: [
        {
          type: String,
          trim: true,
          lowercase: true,
        },
      ],

      set: normalizeStringArray,

      validate: {
        validator(values) {
          return values.length <= PRODUCT_LIMITS.MAX_TAGS;
        },

        message: "Product cannot contain more than 20 tags",
      },

      default: [],
    },

    images: {
      type: [productImageSchema],

      validate: {
        validator(values) {
          return values.length <= PRODUCT_LIMITS.MAX_IMAGES;
        },

        message: "Product cannot contain more than 12 images",
      },

      default: [],
    },

    variants: {
      type: [productVariantSchema],

      validate: [
        {
          validator(values) {
            return Array.isArray(values) && values.length > 0;
          },

          message: "Product must contain at least one variant",
        },

        {
          validator(values) {
            return values.length <= PRODUCT_LIMITS.MAX_VARIANTS;
          },

          message: "Product cannot contain more than 100 variants",
        },
      ],

      required: [true, "Product variants are required"],
    },

    seo: {
      type: productSeoSchema,
      default: () => ({}),
    },

    status: {
      type: String,

      enum: {
        values: PRODUCT_STATUS_VALUES,

        message: "Invalid product status",
      },

      default: PRODUCT_STATUSES.DRAFT,

      index: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },

    isNewArrival: {
      type: Boolean,
      default: false,
      index: true,
    },

    isBestSeller: {
      type: Boolean,
      default: false,
      index: true,
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,

    toJSON: {
      virtuals: true,
    },

    toObject: {
      virtuals: true,
    },
  },
);

/*
|--------------------------------------------------------------------------
| Database Indexes
|--------------------------------------------------------------------------
*/

productSchema.index(
  {
    slug: 1,
  },
  {
    unique: true,
    name: "unique_product_slug",
  },
);

/*
 * SKU values must be unique between products.
 */
productSchema.index(
  {
    "variants.sku": 1,
  },
  {
    unique: true,
    name: "unique_product_variant_sku",
  },
);

productSchema.index(
  {
    category: 1,
    status: 1,
    deletedAt: 1,
    createdAt: -1,
  },
  {
    name: "product_category_status_index",
  },
);

productSchema.index(
  {
    status: 1,
    deletedAt: 1,
    createdAt: -1,
  },
  {
    name: "product_status_created_index",
  },
);

productSchema.index(
  {
    isFeatured: 1,
    status: 1,
    deletedAt: 1,
    createdAt: -1,
  },
  {
    name: "featured_products_index",
  },
);

productSchema.index(
  {
    isNewArrival: 1,
    status: 1,
    deletedAt: 1,
    createdAt: -1,
  },
  {
    name: "new_arrival_products_index",
  },
);

productSchema.index(
  {
    isBestSeller: 1,
    status: 1,
    deletedAt: 1,
    createdAt: -1,
  },
  {
    name: "best_seller_products_index",
  },
);

productSchema.index(
  {
    name: "text",
    brand: "text",
    shortDescription: "text",
    description: "text",
    tags: "text",
  },
  {
    name: "product_search_text_index",

    weights: {
      name: 10,
      brand: 7,
      tags: 5,
      shortDescription: 3,
      description: 1,
    },
  },
);

/*
|--------------------------------------------------------------------------
| Product Validation
|--------------------------------------------------------------------------
*/

productSchema.pre("validate", function () {
  const variants = this.variants ?? [];

  /*
    |--------------------------------------------------------------------------
    | Duplicate SKU Validation
    |--------------------------------------------------------------------------
    */

  const normalizedSkus = variants.map((variant) => {
    return variant.sku?.trim().toUpperCase();
  });

  if (new Set(normalizedSkus).size !== normalizedSkus.length) {
    this.invalidate(
      "variants",
      "Product variants cannot contain duplicate SKUs",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Duplicate Size and Colour Combination
    |--------------------------------------------------------------------------
    */

  const variantCombinations = variants.map((variant) => {
    const size = variant.size?.trim().toLowerCase();

    const colorName = variant.color?.name?.trim().toLowerCase();

    const colorCode = variant.color?.code?.trim().toUpperCase();

    return [size, colorName, colorCode].join("|");
  });

  if (new Set(variantCombinations).size !== variantCombinations.length) {
    this.invalidate(
      "variants",
      "Product variants cannot contain duplicate size and colour combinations",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Primary Image Validation
    |--------------------------------------------------------------------------
    */

  const primaryImageCount = (this.images ?? []).filter((image) => {
    return image.isPrimary;
  }).length;

  if (primaryImageCount > 1) {
    this.invalidate("images", "Product can contain only one primary image");
  }
});

/*
|--------------------------------------------------------------------------
| Product Virtual Fields
|--------------------------------------------------------------------------
*/

productSchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

productSchema.virtual("activeVariantCount").get(function () {
  return (this.variants ?? []).filter((variant) => {
    return variant.isActive;
  }).length;
});

productSchema.virtual("totalStock").get(function () {
  return (this.variants ?? []).reduce((total, variant) => {
    return total + (variant.inventory?.stock ?? 0);
  }, 0);
});

productSchema.virtual("reservedStock").get(function () {
  return (this.variants ?? []).reduce((total, variant) => {
    return total + (variant.inventory?.reservedStock ?? 0);
  }, 0);
});

productSchema.virtual("availableStock").get(function () {
  return (this.variants ?? []).reduce((total, variant) => {
    const stock = variant.inventory?.stock ?? 0;

    const reservedStock = variant.inventory?.reservedStock ?? 0;

    return total + Math.max(stock - reservedStock, 0);
  }, 0);
});

productSchema.virtual("priceRange").get(function () {
  const prices = (this.variants ?? [])
    .filter((variant) => {
      return variant.isActive;
    })
    .map((variant) => {
      return variant.pricing?.discountPrice ?? variant.pricing?.sellingPrice;
    })
    .filter((price) => {
      return Number.isFinite(price);
    });

  if (!prices.length) {
    return {
      minimum: null,
      maximum: null,
      currency: PRODUCT_CURRENCIES.INR,
    };
  }

  return {
    minimum: Math.min(...prices),

    maximum: Math.max(...prices),

    currency:
      this.variants.find((variant) => {
        return variant.isActive;
      })?.pricing?.currency ?? PRODUCT_CURRENCIES.INR,
  };
});

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

productSchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

productSchema.query.active = function () {
  return this.where({
    status: PRODUCT_STATUSES.ACTIVE,

    deletedAt: null,
  });
};

productSchema.query.byCategory = function (categoryId) {
  return this.where({
    category: categoryId,
    deletedAt: null,
  });
};

/*
|--------------------------------------------------------------------------
| Product Model
|--------------------------------------------------------------------------
*/

const Product = mongoose.models.Product || model("Product", productSchema);

export default Product;
