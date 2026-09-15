import mongoose from "mongoose";

import { RECENTLY_VIEWED_LIMITS } from "./recently-viewed.constants.js";

const { Schema } = mongoose;

/*
|--------------------------------------------------------------------------
| Recently Viewed Item Schema
|--------------------------------------------------------------------------
| Stores a Product reference and its most recent viewing time.
| Product ID identifies the entry; a separate item _id is unnecessary.
|--------------------------------------------------------------------------
*/

const recentlyViewedItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    viewedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Recently Viewed Schema
|--------------------------------------------------------------------------
| One history document per customer.
| The service will refresh repeated views and remove the oldest entries
| before saving when the history exceeds its limit.
|--------------------------------------------------------------------------
*/

const recentlyViewedSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },

    items: {
      type: [recentlyViewedItemSchema],
      default: [],
      required: true,

      validate: {
        validator(items) {
          return (
            Array.isArray(items) &&
            items.length <= RECENTLY_VIEWED_LIMITS.MAX_ITEMS
          );
        },

        message:
          `Recently viewed history cannot contain more than ` +
          `${RECENTLY_VIEWED_LIMITS.MAX_ITEMS} items.`,
      },
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
*/

const RecentlyViewed =
  mongoose.models.RecentlyViewed ||
  mongoose.model("RecentlyViewed", recentlyViewedSchema);

export default RecentlyViewed;
