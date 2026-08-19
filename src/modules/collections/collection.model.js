import mongoose from "mongoose";

import {
  COLLECTION_STATUSES,
  COLLECTION_STATUS_VALUES,
} from "../../shared/constants/collection.constants.js";

const { Schema, model } = mongoose;

/*
|--------------------------------------------------------------------------
| Collection Banner Schema
|--------------------------------------------------------------------------
|
| Cloudinary-compatible metadata.
|
| The actual Cloudinary upload feature will be added later.
|--------------------------------------------------------------------------
*/

const collectionBannerSchema = new Schema(
  {
    url: {
      type: String,

      trim: true,

      maxlength: [2048, "Collection banner URL cannot exceed 2048 characters"],

      default: "",
    },

    publicId: {
      type: String,

      trim: true,

      maxlength: [
        300,
        "Collection banner public ID cannot exceed 300 characters",
      ],

      default: "",
    },

    altText: {
      type: String,

      trim: true,

      maxlength: [
        150,
        "Collection banner alt text cannot exceed 150 characters",
      ],

      default: "",
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Collection Schema
|--------------------------------------------------------------------------
*/

const collectionSchema = new Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Basic Information
    |--------------------------------------------------------------------------
    */

    name: {
      type: String,

      required: [true, "Collection name is required"],

      trim: true,

      minlength: [2, "Collection name must contain at least 2 characters"],

      maxlength: [120, "Collection name cannot exceed 120 characters"],
    },

    slug: {
      type: String,

      required: [true, "Collection slug is required"],

      trim: true,

      lowercase: true,

      minlength: [2, "Collection slug must contain at least 2 characters"],

      maxlength: [150, "Collection slug cannot exceed 150 characters"],

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Collection slug can contain lowercase letters, numbers and hyphens only",
      ],
    },

    description: {
      type: String,

      trim: true,

      maxlength: [2000, "Collection description cannot exceed 2000 characters"],

      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Banner
    |--------------------------------------------------------------------------
    |
    | Examples:
    |
    | Summer Collection banner
    | Festive Collection banner
    | New Arrivals banner
    |--------------------------------------------------------------------------
    */

    banner: {
      type: collectionBannerSchema,

      default: () => ({}),
    },

    /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

    status: {
      type: String,

      enum: {
        values: COLLECTION_STATUS_VALUES,

        message: "Invalid collection status",
      },

      default: COLLECTION_STATUSES.ACTIVE,

      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Featured Collection
    |--------------------------------------------------------------------------
    |
    | Useful for storefront sections such as:
    |
    | Featured Collections
    | Shop the Latest
    | Seasonal Collections
    |--------------------------------------------------------------------------
    */

    isFeatured: {
      type: Boolean,

      default: false,

      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Display Order
    |--------------------------------------------------------------------------
    */

    sortOrder: {
      type: Number,

      min: [0, "Collection sort order cannot be negative"],

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
 * Collection slugs remain globally unique,
 * including after soft deletion.
 */
collectionSchema.index(
  {
    slug: 1,
  },
  {
    unique: true,

    name: "unique_collection_slug",
  },
);

/*
 * Admin/public collection listing.
 */
collectionSchema.index(
  {
    status: 1,

    deletedAt: 1,

    sortOrder: 1,

    name: 1,
  },
  {
    name: "collection_status_listing_index",
  },
);

/*
 * Featured storefront collections.
 */
collectionSchema.index(
  {
    isFeatured: 1,

    status: 1,

    deletedAt: 1,

    sortOrder: 1,
  },
  {
    name: "featured_collections_index",
  },
);

/*
 * Admin collection search.
 */
collectionSchema.index(
  {
    name: "text",

    description: "text",
  },
  {
    name: "collection_search_text_index",

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

collectionSchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

collectionSchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

collectionSchema.query.active = function () {
  return this.where({
    status: COLLECTION_STATUSES.ACTIVE,

    deletedAt: null,
  });
};

collectionSchema.query.featured = function () {
  return this.where({
    isFeatured: true,

    status: COLLECTION_STATUSES.ACTIVE,

    deletedAt: null,
  });
};

/*
|--------------------------------------------------------------------------
| Collection Model
|--------------------------------------------------------------------------
*/

const Collection =
  mongoose.models.Collection || model("Collection", collectionSchema);

export default Collection;
