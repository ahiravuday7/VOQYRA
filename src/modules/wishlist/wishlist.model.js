import mongoose from "mongoose";

import { WISHLIST_LIMITS } from "./wishlist.constants.js";

const { Schema } = mongoose;

/*
|--------------------------------------------------------------------------
| Wishlist Item Schema
|--------------------------------------------------------------------------
| Stores only the Product reference and when it was added.
| Variant selection happens when adding a Product to Cart.
| Wishlist does not store pricing or reserve inventory.
|--------------------------------------------------------------------------
*/

const wishlistItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    addedAt: {
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
| Wishlist Schema
|--------------------------------------------------------------------------
| One User -> One Wishlist.
| Items are identified by Product ID, so item _id values are unnecessary.
|--------------------------------------------------------------------------
*/

const wishlistSchema = new Schema(
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
      type: [wishlistItemSchema],
      default: [],
      required: true,
      validate: {
        validator(items) {
          return (
            Array.isArray(items) && items.length <= WISHLIST_LIMITS.MAX_ITEMS
          );
        },
        message: `Wishlist cannot contain more than ${WISHLIST_LIMITS.MAX_ITEMS} items.`,
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

const Wishlist =
  mongoose.models.Wishlist || mongoose.model("Wishlist", wishlistSchema);

export default Wishlist;
