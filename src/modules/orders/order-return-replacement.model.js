import crypto from "node:crypto";

import mongoose from "mongoose";

const { Schema, model } = mongoose;

/*
|--------------------------------------------------------------------------
| Return Replacement Status Values
|--------------------------------------------------------------------------
*/

export const ORDER_RETURN_REPLACEMENT_STATUS = Object.freeze({
  PENDING: "pending",
  RESERVED: "reserved",
  PROCESSING: "processing",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const ORDER_RETURN_REPLACEMENT_STATUS_VALUES = Object.freeze(
  Object.values(ORDER_RETURN_REPLACEMENT_STATUS),
);

/*
|--------------------------------------------------------------------------
| Replacement Number
|--------------------------------------------------------------------------
*/

const createReplacementNumber = () => {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  const randomPart = crypto.randomBytes(6).toString("hex").toUpperCase();

  return `RPL-${datePart}-${randomPart}`;
};

/*
|--------------------------------------------------------------------------
| Replacement Color Snapshot
|--------------------------------------------------------------------------
*/

const replacementColorSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      default: null,
    },

    code: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Replacement Item
|--------------------------------------------------------------------------
*/

const replacementItemSchema = new Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Trusted References
    |--------------------------------------------------------------------------
    */

    returnItemId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },

    orderItemId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },

    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      immutable: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Embedded Product Variant ID
    |--------------------------------------------------------------------------
    |
    | This is Product.variants[n]._id.
    | It is NOT the SKU.
    |
    */

    variantId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Trusted Product Snapshot
    |--------------------------------------------------------------------------
    */

    productName: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    sku: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    size: {
      type: String,
      trim: true,
      default: null,
      immutable: true,
    },

    color: {
      type: replacementColorSchema,
      default: null,
      immutable: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Trusted Quantities
    |--------------------------------------------------------------------------
    */

    returnedQuantity: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },

    replacementQuantity: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },
  },
  {
    _id: true,
  },
);

/*
|--------------------------------------------------------------------------
| Replacement Reservation
|--------------------------------------------------------------------------
*/

const replacementReservationSchema = new Schema(
  {
    reservedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reservedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Replacement Processing
|--------------------------------------------------------------------------
*/

const replacementProcessingSchema = new Schema(
  {
    note: {
      type: String,
      trim: true,
      default: null,
    },

    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Replacement Shipment
|--------------------------------------------------------------------------
*/

const replacementShipmentSchema = new Schema(
  {
    carrier: {
      type: String,
      trim: true,
      default: null,
    },

    trackingNumber: {
      type: String,
      trim: true,
      default: null,
    },

    trackingUrl: {
      type: String,
      trim: true,
      default: null,
    },

    note: {
      type: String,
      trim: true,
      default: null,
    },

    shippedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    shippedAt: {
      type: Date,
      default: null,
    },

    deliveredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Replacement Cancellation
|--------------------------------------------------------------------------
*/

const replacementCancellationSchema = new Schema(
  {
    reason: {
      type: String,
      trim: true,
      default: null,
    },

    note: {
      type: String,
      trim: true,
      default: null,
    },

    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Replacement Failure
|--------------------------------------------------------------------------
*/

const replacementFailureSchema = new Schema(
  {
    reason: {
      type: String,
      trim: true,
      default: null,
    },

    note: {
      type: String,
      trim: true,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Return Replacement
|--------------------------------------------------------------------------
*/

const orderReturnReplacementSchema = new Schema(
  {
    replacementNumber: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Parent Return Request
    |--------------------------------------------------------------------------
    */

    returnRequest: {
      type: Schema.Types.ObjectId,
      ref: "OrderReturnRequest",
      required: true,
      immutable: true,
    },

    returnRequestNumber: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Original Order
    |--------------------------------------------------------------------------
    */

    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      immutable: true,
    },

    orderNumber: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Replacement State
    |--------------------------------------------------------------------------
    */

    status: {
      type: String,
      enum: ORDER_RETURN_REPLACEMENT_STATUS_VALUES,
      default: ORDER_RETURN_REPLACEMENT_STATUS.PENDING,
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Trusted Replacement Items
    |--------------------------------------------------------------------------
    */

    items: {
      type: [replacementItemSchema],
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Fulfillment State
    |--------------------------------------------------------------------------
    */

    reservation: {
      type: replacementReservationSchema,
      default: null,
    },

    processing: {
      type: replacementProcessingSchema,
      default: null,
    },

    shipment: {
      type: replacementShipmentSchema,
      default: null,
    },

    cancellation: {
      type: replacementCancellationSchema,
      default: null,
    },

    failure: {
      type: replacementFailureSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
|
| One Return Request may have at most ONE replacement.
|
*/

orderReturnReplacementSchema.index(
  {
    replacementNumber: 1,
  },
  {
    unique: true,
  },
);

orderReturnReplacementSchema.index(
  {
    returnRequest: 1,
  },
  {
    unique: true,
  },
);

orderReturnReplacementSchema.index(
  {
    returnRequestNumber: 1,
  },
  {
    unique: true,
  },
);

orderReturnReplacementSchema.index({
  order: 1,
  createdAt: -1,
});

orderReturnReplacementSchema.index({
  customer: 1,
  createdAt: -1,
});

orderReturnReplacementSchema.index({
  status: 1,
  createdAt: -1,
});

/*
|--------------------------------------------------------------------------
| Replacement Number Generation
|--------------------------------------------------------------------------
*/

orderReturnReplacementSchema.pre("validate", function () {
  if (!this.replacementNumber) {
    this.replacementNumber = createReplacementNumber();
  }
});

/*
|--------------------------------------------------------------------------
| Replacement Item Invariants
|--------------------------------------------------------------------------
*/

orderReturnReplacementSchema.pre("validate", function () {
  if (!Array.isArray(this.items) || this.items.length === 0) {
    throw new Error(
      "A Return replacement must contain at least one replacement item",
    );
  }

  for (const item of this.items) {
    if (item.replacementQuantity > item.returnedQuantity) {
      throw new Error("Replacement quantity cannot exceed returned quantity");
    }
  }
});

/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
*/

const OrderReturnReplacement =
  mongoose.models.OrderReturnReplacement ??
  model("OrderReturnReplacement", orderReturnReplacementSchema);

export default OrderReturnReplacement;
