import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Order Return Refund Audit Item
|--------------------------------------------------------------------------
*/

const orderReturnRefundAuditItemSchema = new mongoose.Schema(
  {
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,

      required: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Product",

      required: true,
    },

    variantId: {
      type: mongoose.Schema.Types.ObjectId,

      required: true,
    },

    sku: {
      type: String,

      trim: true,

      required: true,
    },

    returnedQuantity: {
      type: Number,

      required: true,

      min: 1,

      validate: {
        validator: Number.isInteger,

        message: "Returned quantity must be a whole number",
      },
    },

    refundableQuantity: {
      type: Number,

      required: true,

      min: 1,

      validate: {
        validator: Number.isInteger,

        message: "Refundable quantity must be a whole number",
      },
    },

    rejectedQuantity: {
      type: Number,

      required: true,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Rejected quantity must be a whole number",
      },
    },

    unitRefundAmount: {
      type: Number,

      required: true,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Unit refund amount must be a whole number",
      },
    },

    lineRefundAmount: {
      type: Number,

      required: true,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Line refund amount must be a whole number",
      },
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Return Refund Audit
|--------------------------------------------------------------------------
*/

const orderReturnRefundAuditSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Order",

      required: true,
    },

    orderNumber: {
      type: String,

      trim: true,

      required: true,
    },

    returnRequest: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "OrderReturnRequest",

      required: true,
    },

    returnRequestNumber: {
      type: String,

      trim: true,

      required: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,
    },

    items: {
      type: [orderReturnRefundAuditItemSchema],

      required: true,

      validate: {
        validator: (items) => {
          return Array.isArray(items) && items.length > 0;
        },

        message: "At least one refunded Return item is required",
      },
    },

    refundedQuantity: {
      type: Number,

      required: true,

      min: 1,

      validate: {
        validator: Number.isInteger,

        message: "Refunded quantity must be a whole number",
      },
    },

    amount: {
      type: Number,

      required: true,

      min: 1,

      validate: {
        validator: Number.isInteger,

        message: "Refund amount must be a whole number",
      },
    },

    currency: {
      type: String,

      trim: true,

      required: true,
    },

    previousPaymentStatus: {
      type: String,

      trim: true,

      required: true,
    },

    paymentStatus: {
      type: String,

      trim: true,

      required: true,
    },

    previousCumulativeRefundAmount: {
      type: Number,

      required: true,

      min: 0,
    },

    cumulativeRefundAmount: {
      type: Number,

      required: true,

      min: 1,
    },

    orderGrandTotal: {
      type: Number,

      required: true,

      min: 1,
    },

    referenceId: {
      type: String,

      trim: true,

      required: true,

      maxlength: 200,
    },

    note: {
      type: String,

      trim: true,

      default: null,

      maxlength: 1000,
    },

    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,
    },

    refundedAt: {
      type: Date,

      required: true,
    },
  },

  {
    timestamps: {
      createdAt: true,

      updatedAt: false,
    },

    versionKey: false,
  },
);

/*
|--------------------------------------------------------------------------
| Audit Indexes
|--------------------------------------------------------------------------
|
| One financial refund per Return Request.
|
| One external refund reference may never be reused.
|--------------------------------------------------------------------------
*/

orderReturnRefundAuditSchema.index(
  {
    returnRequest: 1,
  },
  {
    unique: true,
  },
);

orderReturnRefundAuditSchema.index(
  {
    referenceId: 1,
  },
  {
    unique: true,
  },
);

orderReturnRefundAuditSchema.index(
  {
    returnRequestNumber: 1,
  },
  {
    unique: true,
  },
);

orderReturnRefundAuditSchema.index({
  order: 1,

  refundedAt: -1,
});

orderReturnRefundAuditSchema.index({
  customer: 1,

  refundedAt: -1,
});

/*
|--------------------------------------------------------------------------
| Immutable Audit Protection
|--------------------------------------------------------------------------
|
| Mongoose 9 middleware does not use next().
|--------------------------------------------------------------------------
*/

orderReturnRefundAuditSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error("Order Return Refund Audit records are immutable");
  }
});

const preventOrderReturnRefundAuditMutation = function () {
  throw new Error("Order Return Refund Audit records are immutable");
};

orderReturnRefundAuditSchema.pre(
  "updateOne",
  preventOrderReturnRefundAuditMutation,
);

orderReturnRefundAuditSchema.pre(
  "updateMany",
  preventOrderReturnRefundAuditMutation,
);

orderReturnRefundAuditSchema.pre(
  "findOneAndUpdate",
  preventOrderReturnRefundAuditMutation,
);

orderReturnRefundAuditSchema.pre(
  "replaceOne",
  preventOrderReturnRefundAuditMutation,
);

orderReturnRefundAuditSchema.pre(
  "deleteOne",
  preventOrderReturnRefundAuditMutation,
);

orderReturnRefundAuditSchema.pre(
  "deleteMany",
  preventOrderReturnRefundAuditMutation,
);

orderReturnRefundAuditSchema.pre(
  "findOneAndDelete",
  preventOrderReturnRefundAuditMutation,
);

const OrderReturnRefundAudit =
  mongoose.models.OrderReturnRefundAudit ??
  mongoose.model("OrderReturnRefundAudit", orderReturnRefundAuditSchema);

export default OrderReturnRefundAudit;
