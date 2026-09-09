import mongoose from "mongoose";

const { Schema } = mongoose;

/*
|--------------------------------------------------------------------------
| Cart Item Schema
|--------------------------------------------------------------------------
|
| Important:
|
| product
|   → references the Product document.
|
| variantId
|   → references the Product variant subdocument _id.
|     It is NOT a separate MongoDB model, so it does not use `ref`.
|
| quantity
|   → how many units the customer wants.
|
| Adding an item to Cart does NOT reserve inventory.
|--------------------------------------------------------------------------
*/

const cartItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    variantId: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    _id: true,
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Cart Schema
|--------------------------------------------------------------------------
|
| One User → One Cart
|
| The unique index on `user` guarantees that a customer cannot have
| multiple Cart documents.
|--------------------------------------------------------------------------
*/

const cartSchema = new Schema(
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
      type: [cartItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Useful Index
|--------------------------------------------------------------------------
|
| Helps queries involving Product references inside Cart items.
|--------------------------------------------------------------------------
*/

cartSchema.index({
  "items.product": 1,
});

/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
*/

const Cart = mongoose.models.Cart || mongoose.model("Cart", cartSchema);

export default Cart;
