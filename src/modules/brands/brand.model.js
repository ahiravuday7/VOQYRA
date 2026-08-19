import mongoose from "mongoose";

import {
  BRAND_STATUSES,
  BRAND_STATUS_VALUES,
} from "../../shared/constants/brand.constants.js";

const { Schema, model } = mongoose;

/*
|--------------------------------------------------------------------------
| Brand Logo Schema
|--------------------------------------------------------------------------
*/

const brandLogoSchema = new Schema(
  {
    url: {
      type: String,
      trim: true,
      maxlength: [2048, "Brand logo URL cannot exceed 2048 characters"],
      default: "",
    },

    publicId: {
      type: String,
      trim: true,
      maxlength: [300, "Brand logo public ID cannot exceed 300 characters"],
      default: "",
    },

    altText: {
      type: String,
      trim: true,
      maxlength: [150, "Brand logo alt text cannot exceed 150 characters"],
      default: "",
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Brand Schema
|--------------------------------------------------------------------------
*/

const brandSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,

      minlength: [2, "Brand name must contain at least 2 characters"],

      maxlength: [100, "Brand name cannot exceed 100 characters"],
    },

    slug: {
      type: String,
      required: [true, "Brand slug is required"],
      trim: true,
      lowercase: true,

      minlength: [2, "Brand slug must contain at least 2 characters"],

      maxlength: [150, "Brand slug cannot exceed 150 characters"],

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Brand slug can contain lowercase letters, numbers and hyphens only",
      ],
    },

    description: {
      type: String,
      trim: true,

      maxlength: [1000, "Brand description cannot exceed 1000 characters"],

      default: "",
    },

    logo: {
      type: brandLogoSchema,
      default: () => ({}),
    },

    status: {
      type: String,

      enum: {
        values: BRAND_STATUS_VALUES,
        message: "Invalid brand status",
      },

      default: BRAND_STATUSES.ACTIVE,

      index: true,
    },

    /*
     * Allows selected brands to appear in sections such as:
     *
     * Featured Brands
     * Shop by Brand
     */
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },

    /*
     * Controls brand display order.
     */
    sortOrder: {
      type: Number,

      min: [0, "Brand sort order cannot be negative"],

      default: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Audit Fields
    |--------------------------------------------------------------------------
    */

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

    /*
    |--------------------------------------------------------------------------
    | Soft Deletion
    |--------------------------------------------------------------------------
    */

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

/*
 * Brand slugs are globally unique.
 *
 * Example:
 *
 * Nike
 * → nike
 *
 * Levi's
 * → levis
 */
brandSchema.index(
  {
    slug: 1,
  },
  {
    unique: true,
    name: "unique_brand_slug",
  },
);

/*
 * Used by public and admin brand listings.
 */
brandSchema.index(
  {
    status: 1,
    deletedAt: 1,
    sortOrder: 1,
    name: 1,
  },
  {
    name: "brand_status_listing_index",
  },
);

/*
 * Used by featured-brand sections.
 */
brandSchema.index(
  {
    isFeatured: 1,
    status: 1,
    deletedAt: 1,
    sortOrder: 1,
  },
  {
    name: "featured_brands_index",
  },
);

/*
 * Basic admin brand search.
 */
brandSchema.index(
  {
    name: "text",
    description: "text",
  },
  {
    name: "brand_search_text_index",

    weights: {
      name: 10,
      description: 2,
    },
  },
);

/*
|--------------------------------------------------------------------------
| Virtual Fields
|--------------------------------------------------------------------------
*/

brandSchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

brandSchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

brandSchema.query.active = function () {
  return this.where({
    status: BRAND_STATUSES.ACTIVE,
    deletedAt: null,
  });
};

brandSchema.query.featured = function () {
  return this.where({
    isFeatured: true,
    status: BRAND_STATUSES.ACTIVE,
    deletedAt: null,
  });
};

/*
|--------------------------------------------------------------------------
| Brand Model
|--------------------------------------------------------------------------
*/

const Brand = mongoose.models.Brand || model("Brand", brandSchema);

export default Brand;
