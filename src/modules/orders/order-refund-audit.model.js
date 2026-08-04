import mongoose from "mongoose";

import {
  ORDER_PAYMENT_METHOD_VALUES,
  ORDER_PAYMENT_STATUS_VALUES,
} from "../../shared/constants/order.constants.js";

/*
|--------------------------------------------------------------------------
| Order Refund Audit Schema
|--------------------------------------------------------------------------
|
| One completed full-refund record is allowed per Order.
|
| This collection is separate from the embedded Order refund snapshot so
| financial refund records remain independently queryable and auditable.
|--------------------------------------------------------------------------
*/

const orderRefundAuditSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,

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
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,

      immutable: true,
    },

    paymentMethod: {
      type: String,

      enum: ORDER_PAYMENT_METHOD_VALUES,

      required: true,

      immutable: true,
    },

    previousPaymentStatus: {
      type: String,

      enum: ORDER_PAYMENT_STATUS_VALUES,

      required: true,

      immutable: true,
    },

    paymentStatus: {
      type: String,

      enum: ORDER_PAYMENT_STATUS_VALUES,

      required: true,

      immutable: true,
    },

    amount: {
      type: Number,

      required: true,

      min: 0.01,

      immutable: true,
    },

    currency: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      immutable: true,
    },

    reason: {
      type: String,

      required: true,

      trim: true,

      minlength: 5,

      maxlength: 500,

      immutable: true,
    },

    referenceId: {
      type: String,

      required: true,

      trim: true,

      minlength: 3,

      maxlength: 200,

      immutable: true,
    },

    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,

      immutable: true,
    },

    refundedAt: {
      type: Date,

      required: true,

      immutable: true,
    },
  },

  {
    collection: "order_refund_audits",

    timestamps: {
      createdAt: true,

      updatedAt: false,
    },

    versionKey: false,
  },
);

/*
|--------------------------------------------------------------------------
| Refund Audit Indexes
|--------------------------------------------------------------------------
*/

orderRefundAuditSchema.index(
  {
    order: 1,
  },
  {
    unique: true,

    name: "unique_order_refund_audit",
  },
);

orderRefundAuditSchema.index(
  {
    referenceId: 1,
  },
  {
    unique: true,

    name: "unique_refund_reference",
  },
);

orderRefundAuditSchema.index(
  {
    customer: 1,

    refundedAt: -1,
  },
  {
    name: "customer_refunds_by_date",
  },
);

orderRefundAuditSchema.index(
  {
    refundedAt: -1,
  },
  {
    name: "refunds_by_date",
  },
);

const OrderRefundAudit =
  mongoose.models.OrderRefundAudit ??
  mongoose.model("OrderRefundAudit", orderRefundAuditSchema);

export default OrderRefundAudit;
