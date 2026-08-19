import mongoose from "mongoose";

import {
  SIZE_GUIDE_STATUSES,
  SIZE_GUIDE_STATUS_VALUES,
  SIZE_GUIDE_UNITS,
  SIZE_GUIDE_UNIT_VALUES,
} from "../../shared/constants/size-guide.constants.js";

const { Schema, model } = mongoose;

/*
|--------------------------------------------------------------------------
| Size Guide Column Schema
|--------------------------------------------------------------------------
|
| Defines which measurements appear in the guide.
|
| Example:
|
| {
|   key: "chest",
|   label: "Chest",
|   sortOrder: 1
| }
|--------------------------------------------------------------------------
*/

const sizeGuideColumnSchema = new Schema(
  {
    key: {
      type: String,

      required: [true, "Size guide column key is required"],

      trim: true,

      lowercase: true,

      minlength: [1, "Size guide column key cannot be empty"],

      maxlength: [50, "Size guide column key cannot exceed 50 characters"],

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Size guide column key can contain lowercase letters, numbers and hyphens only",
      ],
    },

    label: {
      type: String,

      required: [true, "Size guide column label is required"],

      trim: true,

      minlength: [1, "Size guide column label cannot be empty"],

      maxlength: [80, "Size guide column label cannot exceed 80 characters"],
    },

    sortOrder: {
      type: Number,

      min: [0, "Size guide column sort order cannot be negative"],

      default: 0,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Size Guide Measurement Schema
|--------------------------------------------------------------------------
|
| Example:
|
| {
|   key: "chest",
|   value: "36-38"
| }
|
| value is intentionally stored as a string.
|
| This allows:
|
| 36
| 36.5
| 36-38
| 91-96
| 26.5
|
| without forcing every clothing measurement into one numeric format.
|--------------------------------------------------------------------------
*/

const sizeGuideMeasurementSchema = new Schema(
  {
    key: {
      type: String,

      required: [true, "Size guide measurement key is required"],

      trim: true,

      lowercase: true,

      maxlength: [50, "Size guide measurement key cannot exceed 50 characters"],

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Size guide measurement key can contain lowercase letters, numbers and hyphens only",
      ],
    },

    value: {
      type: String,

      required: [true, "Size guide measurement value is required"],

      trim: true,

      maxlength: [
        50,
        "Size guide measurement value cannot exceed 50 characters",
      ],
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Size Guide Row Schema
|--------------------------------------------------------------------------
|
| Example:
|
| {
|   size: "M",
|
|   measurements: [
|     {
|       key: "chest",
|       value: "38"
|     },
|     {
|       key: "waist",
|       value: "32"
|     }
|   ]
| }
|--------------------------------------------------------------------------
*/

const sizeGuideRowSchema = new Schema(
  {
    size: {
      type: String,

      required: [true, "Size guide row size is required"],

      trim: true,

      maxlength: [30, "Size guide size cannot exceed 30 characters"],
    },

    measurements: {
      type: [sizeGuideMeasurementSchema],

      default: [],
    },

    sortOrder: {
      type: Number,

      min: [0, "Size guide row sort order cannot be negative"],

      default: 0,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Size Guide Schema
|--------------------------------------------------------------------------
*/

const sizeGuideSchema = new Schema(
  {
    name: {
      type: String,

      required: [true, "Size guide name is required"],

      trim: true,

      minlength: [2, "Size guide name must contain at least 2 characters"],

      maxlength: [120, "Size guide name cannot exceed 120 characters"],
    },

    slug: {
      type: String,

      required: [true, "Size guide slug is required"],

      trim: true,

      lowercase: true,

      minlength: [2, "Size guide slug must contain at least 2 characters"],

      maxlength: [150, "Size guide slug cannot exceed 150 characters"],

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Size guide slug can contain lowercase letters, numbers and hyphens only",
      ],
    },

    description: {
      type: String,

      trim: true,

      maxlength: [1000, "Size guide description cannot exceed 1000 characters"],

      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Optional Category Classification
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | Men
    |   ↓
    | T-Shirts
    |   ↓
    | Men's T-Shirt Size Guide
    |
    | This does NOT replace the future Product → SizeGuide relationship.
    | It simply helps classify which type of products the guide is intended for.
    |--------------------------------------------------------------------------
    */

    category: {
      type: Schema.Types.ObjectId,

      ref: "Category",

      default: null,

      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Measurement Unit
    |--------------------------------------------------------------------------
    */

    unit: {
      type: String,

      enum: {
        values: SIZE_GUIDE_UNIT_VALUES,

        message: "Size guide unit must be cm or in",
      },

      default: SIZE_GUIDE_UNITS.CENTIMETER,
    },

    /*
    |--------------------------------------------------------------------------
    | Columns
    |--------------------------------------------------------------------------
    |
    | Defines the measurement headings.
    |--------------------------------------------------------------------------
    */

    columns: {
      type: [sizeGuideColumnSchema],

      default: [],

      validate: {
        validator(columns) {
          const keys = columns.map((column) => column.key);

          return new Set(keys).size === keys.length;
        },

        message: "Size guide column keys must be unique",
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Size Rows
    |--------------------------------------------------------------------------
    */

    rows: {
      type: [sizeGuideRowSchema],

      default: [],

      validate: {
        validator(rows) {
          const sizes = rows.map((row) => row.size.trim().toLowerCase());

          return new Set(sizes).size === sizes.length;
        },

        message: "Size guide row sizes must be unique",
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Customer Instructions
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | Measure around the fullest part of your chest.
    |--------------------------------------------------------------------------
    */

    howToMeasure: {
      type: String,

      trim: true,

      maxlength: [
        2000,
        "Size guide measurement instructions cannot exceed 2000 characters",
      ],

      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Fit Note
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | This product has an oversized fit.
    |--------------------------------------------------------------------------
    */

    fitNote: {
      type: String,

      trim: true,

      maxlength: [500, "Size guide fit note cannot exceed 500 characters"],

      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

    status: {
      type: String,

      enum: {
        values: SIZE_GUIDE_STATUS_VALUES,

        message: "Invalid size guide status",
      },

      default: SIZE_GUIDE_STATUSES.ACTIVE,

      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Display Order
    |--------------------------------------------------------------------------
    */

    sortOrder: {
      type: Number,

      min: [0, "Size guide sort order cannot be negative"],

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
 * Size-guide slugs remain globally unique.
 */
sizeGuideSchema.index(
  {
    slug: 1,
  },
  {
    unique: true,

    name: "unique_size_guide_slug",
  },
);

/*
 * Admin/public listing queries.
 */
sizeGuideSchema.index(
  {
    status: 1,

    deletedAt: 1,

    sortOrder: 1,

    name: 1,
  },
  {
    name: "size_guide_status_listing_index",
  },
);

/*
 * Useful when selecting guides for a product category.
 */
sizeGuideSchema.index(
  {
    category: 1,

    status: 1,

    deletedAt: 1,

    sortOrder: 1,
  },
  {
    name: "size_guide_category_index",
  },
);

/*
 * Basic admin search.
 */
sizeGuideSchema.index(
  {
    name: "text",

    description: "text",
  },
  {
    name: "size_guide_search_text_index",

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

sizeGuideSchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

/*
|--------------------------------------------------------------------------
| Size Guide Cross-Field Validation
|--------------------------------------------------------------------------
*/

sizeGuideSchema.pre(
  "validate",

  function () {
    /*
    |--------------------------------------------------------------------------
    | Validate Measurement Keys
    |--------------------------------------------------------------------------
    |
    | Every measurement used by a row must correspond to a defined column.
    |--------------------------------------------------------------------------
    */

    const columnKeys = new Set(this.columns.map((column) => column.key));

    for (const row of this.rows) {
      const measurementKeys = row.measurements.map(
        (measurement) => measurement.key,
      );

      /*
       * A row cannot contain the same
       * measurement twice.
       */
      if (new Set(measurementKeys).size !== measurementKeys.length) {
        this.invalidate(
          "rows",
          `Size "${row.size}" contains duplicate measurement keys`,
        );

        continue;
      }

      /*
       * Every row measurement must
       * reference an existing column.
       */
      for (const key of measurementKeys) {
        if (!columnKeys.has(key)) {
          this.invalidate(
            "rows",
            `Size "${row.size}" uses unknown measurement key "${key}"`,
          );
        }
      }
    }
  },
);

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

sizeGuideSchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

sizeGuideSchema.query.active = function () {
  return this.where({
    status: SIZE_GUIDE_STATUSES.ACTIVE,

    deletedAt: null,
  });
};

/*
|--------------------------------------------------------------------------
| Size Guide Model
|--------------------------------------------------------------------------
*/

const SizeGuide =
  mongoose.models.SizeGuide || model("SizeGuide", sizeGuideSchema);

export default SizeGuide;
