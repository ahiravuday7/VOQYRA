import mongoose from "mongoose";

import {
  CATEGORY_STATUSES,
  CATEGORY_STATUS_VALUES,
} from "../../shared/constants/category.constants.js";

const { Schema, model } = mongoose;

/*
| Category Image Schema
*/

const categoryImageSchema = new Schema(
  {
    url: {
      type: String,
      trim: true,
      default: "",
    },

    publicId: {
      type: String,
      trim: true,
      default: "",
    },

    altText: {
      type: String,
      trim: true,
      maxlength: [150, "Image alt text cannot exceed 150 characters"],
      default: "",
    },
  },
  {
    _id: false,
  },
);

/*
| Category SEO Schema
*/

const categorySeoSchema = new Schema(
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
      default: [],
    },
  },
  {
    _id: false,
  },
);

/*
| Category Schema
*/

const categorySchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      minlength: [2, "Category name must contain at least 2 characters"],
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },

    slug: {
      type: String,
      required: [true, "Category slug is required"],
      trim: true,
      lowercase: true,

      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Category slug can contain lowercase letters, numbers and hyphens only",
      ],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Category description cannot exceed 1000 characters"],
      default: "",
    },

    /*
     * Immediate parent category.
     *
     * Example:
     * T-Shirts → parent is Topwear
     */
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },

    /*
     * All parent categories from root to immediate parent.
     *
     * Example for Oversized T-Shirts:
     *
     * [
     *   MEN_CATEGORY_ID,
     *   TOPWEAR_CATEGORY_ID,
     *   TSHIRTS_CATEGORY_ID
     * ]
     */
    ancestors: [
      {
        type: Schema.Types.ObjectId,
        ref: "Category",
      },
    ],

    /*
     * Root category level = 0
     * Child category level = ancestors.length
     */
    level: {
      type: Number,
      min: [0, "Category level cannot be negative"],
      default: 0,
    },

    image: {
      type: categoryImageSchema,
      default: () => ({}),
    },

    bannerImage: {
      type: categoryImageSchema,
      default: () => ({}),
    },

    seo: {
      type: categorySeoSchema,
      default: () => ({}),
    },

    status: {
      type: String,
      enum: {
        values: CATEGORY_STATUS_VALUES,
        message: "Invalid category status",
      },
      default: CATEGORY_STATUSES.ACTIVE,
      index: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },

    /*
     * Controls category display order.
     */
    sortOrder: {
      type: Number,
      min: [0, "Category sort order cannot be negative"],
      default: 0,
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
| Database Indexes
*/

/*
 * Category slugs are globally unique.
 */
categorySchema.index(
  {
    slug: 1,
  },
  {
    unique: true,
    name: "unique_category_slug",
  },
);

/*
 * Used for loading child categories.
 */
categorySchema.index(
  {
    parent: 1,
    status: 1,
    deletedAt: 1,
    sortOrder: 1,
  },
  {
    name: "category_parent_status_index",
  },
);

/*
 * Used for finding every category below an ancestor.
 */
categorySchema.index(
  {
    ancestors: 1,
    status: 1,
    deletedAt: 1,
  },
  {
    name: "category_ancestors_index",
  },
);

/*
 * Used for featured-category sections.
 */
categorySchema.index(
  {
    isFeatured: 1,
    status: 1,
    deletedAt: 1,
    sortOrder: 1,
  },
  {
    name: "featured_categories_index",
  },
);

/*
 * Basic admin search.
 */
categorySchema.index(
  {
    name: "text",
    description: "text",
  },
  {
    name: "category_search_text_index",
    weights: {
      name: 10,
      description: 2,
    },
  },
);

/*
| Virtual Fields
*/

categorySchema.virtual("isRoot").get(function () {
  return !this.parent;
});

categorySchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

/*
| Category Validation
*/

categorySchema.pre("validate", function () {
  /*
   * A category cannot be its own parent.
   */
  if (this.parent && this._id && this.parent.equals(this._id)) {
    this.invalidate("parent", "A category cannot be its own parent");
  }

  /*
   * Root categories cannot have ancestors.
   */
  if (!this.parent) {
    this.ancestors = [];
    this.level = 0;

    return;
  }

  const ancestorIds = this.ancestors.map((ancestorId) => String(ancestorId));

  /*
   * Ancestors must not contain duplicate IDs.
   */
  if (new Set(ancestorIds).size !== ancestorIds.length) {
    this.invalidate(
      "ancestors",
      "Category ancestors cannot contain duplicate IDs",
    );
  }

  /*
   * A category cannot appear inside its own ancestry.
   */
  if (this._id && ancestorIds.includes(String(this._id))) {
    this.invalidate("ancestors", "A category cannot be its own ancestor");
  }

  this.level = this.ancestors.length;
});

/*
| Query Helpers
*/

categorySchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

categorySchema.query.active = function () {
  return this.where({
    status: CATEGORY_STATUSES.ACTIVE,
    deletedAt: null,
  });
};

categorySchema.query.rootCategories = function () {
  return this.where({
    parent: null,
    deletedAt: null,
  });
};

categorySchema.query.childrenOf = function (parentId) {
  return this.where({
    parent: parentId,
    deletedAt: null,
  });
};

/*
| Category Model
*/

const Category = mongoose.models.Category || model("Category", categorySchema);

export default Category;

/* Complete model flow
Category data provided
        ↓
Mongoose creates Category document
        ↓
Default values applied
        ↓
String trimming/lowercasing applied
        ↓
pre("validate") runs
        ↓
Prevent self-parent
        ↓
Root category?
   Yes → ancestors = [], level = 0
   No  → validate ancestor duplicates
        → prevent self in ancestors
        → level = ancestors.length
        ↓
Mongoose field validation runs
        ↓
Required/min/max/enum/regex checked
        ↓
Document saved in categories collection
        ↓
Indexes support fast queries
        ↓
Virtuals provide isRoot and isDeleted

The easiest way to remember the model is:

parent
→ immediate parent

ancestors
→ complete path

level
→ hierarchy depth

status
→ visible or inactive

deletedAt
→ soft deletion

sortOrder
→ display sequence

query helpers
→ reusable category filters */
