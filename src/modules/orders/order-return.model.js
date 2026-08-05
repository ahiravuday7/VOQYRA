import mongoose from "mongoose";

import {
  ORDER_RETURN_ITEM_INSPECTION_STATUSES,
  ORDER_RETURN_ITEM_INSPECTION_STATUS_VALUES,
  ORDER_RETURN_REASON_VALUES,
  ORDER_RETURN_RESOLUTION_VALUES,
  ORDER_RETURN_STATUSES,
  ORDER_RETURN_STATUS_VALUES,
} from "../../shared/constants/order.constants.js";

/*
|--------------------------------------------------------------------------
| Integer Quantity Validator
|--------------------------------------------------------------------------
*/

const integerQuantityValidator = {
  validator(value) {
    return Number.isInteger(value);
  },

  message: "Quantity must be a whole number",
};

/*
|--------------------------------------------------------------------------
| Order Return Item Inspection
|--------------------------------------------------------------------------
|
| Warehouse inspection does not directly change Product inventory.
|
| A later workflow may:
|
| - Restock resellableQuantity
| - Record damagedQuantity
| - Leave rejectedQuantity outside inventory
|--------------------------------------------------------------------------
*/

const orderReturnItemInspectionSchema = new mongoose.Schema(
  {
    status: {
      type: String,

      enum: ORDER_RETURN_ITEM_INSPECTION_STATUS_VALUES,

      default: ORDER_RETURN_ITEM_INSPECTION_STATUSES.PENDING,

      required: true,
    },

    resellableQuantity: {
      type: Number,

      min: 0,

      default: 0,

      required: true,

      validate: integerQuantityValidator,
    },

    damagedQuantity: {
      type: Number,

      min: 0,

      default: 0,

      required: true,

      validate: integerQuantityValidator,
    },

    rejectedQuantity: {
      type: Number,

      min: 0,

      default: 0,

      required: true,

      validate: integerQuantityValidator,
    },

    note: {
      type: String,

      trim: true,

      maxlength: 1000,

      default: null,
    },

    inspectedBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },

    inspectedAt: {
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
| Order Return Item
|--------------------------------------------------------------------------
|
| Product information is copied from the trusted Order item snapshot.
|
| It must not be accepted directly from the customer request.
|--------------------------------------------------------------------------
*/

const orderReturnItemSchema = new mongoose.Schema(
  {
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,

      required: true,

      immutable: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Product",

      required: true,

      immutable: true,
    },

    variantId: {
      type: mongoose.Schema.Types.ObjectId,

      required: true,

      immutable: true,
    },

    sku: {
      type: String,

      required: true,

      trim: true,

      immutable: true,
    },

    productName: {
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
      name: {
        type: String,

        trim: true,

        default: null,

        immutable: true,
      },

      code: {
        type: String,

        trim: true,

        default: null,

        immutable: true,
      },
    },

    quantity: {
      type: Number,

      required: true,

      min: 1,

      validate: integerQuantityValidator,

      immutable: true,
    },

    reason: {
      type: String,

      enum: ORDER_RETURN_REASON_VALUES,

      required: true,

      immutable: true,
    },

    details: {
      type: String,

      trim: true,

      maxlength: 500,

      default: null,

      immutable: true,
    },

    inspection: {
      type: orderReturnItemInspectionSchema,

      default: () => ({
        status: ORDER_RETURN_ITEM_INSPECTION_STATUSES.PENDING,

        resellableQuantity: 0,

        damagedQuantity: 0,

        rejectedQuantity: 0,
      }),

      required: true,
    },
  },

  {
    _id: true,
  },
);

/*
|--------------------------------------------------------------------------
| Return Shipment Schema
|--------------------------------------------------------------------------
*/

const orderReturnShipmentSchema = new mongoose.Schema(
  {
    carrier: {
      type: String,

      trim: true,

      default: null,

      maxlength: 100,
    },

    trackingNumber: {
      type: String,

      trim: true,

      default: null,

      maxlength: 100,
    },

    trackingUrl: {
      type: String,

      trim: true,

      default: null,

      maxlength: 500,
    },

    note: {
      type: String,

      trim: true,

      default: null,

      maxlength: 1000,
    },

    markedInTransitBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },

    markedInTransitAt: {
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
| Order Return Request
|--------------------------------------------------------------------------
*/

const orderReturnRequestSchema = new mongoose.Schema(
  {
    returnRequestNumber: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      immutable: true,
    },

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

    items: {
      type: [orderReturnItemSchema],

      required: true,

      validate: {
        validator(items) {
          return Array.isArray(items) && items.length > 0;
        },

        message: "A return request must contain at least one item",
      },
    },

    requestedResolution: {
      type: String,

      enum: ORDER_RETURN_RESOLUTION_VALUES,

      required: true,

      immutable: true,
    },

    status: {
      type: String,

      enum: ORDER_RETURN_STATUS_VALUES,

      default: ORDER_RETURN_STATUSES.REQUESTED,

      required: true,
    },

    customerNote: {
      type: String,

      trim: true,

      maxlength: 1000,

      default: null,

      immutable: true,
    },

    adminNote: {
      type: String,

      trim: true,

      maxlength: 1000,

      default: null,
    },

    approval: {
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null,
      },

      approvedAt: {
        type: Date,

        default: null,
      },
    },

    rejection: {
      reason: {
        type: String,

        trim: true,

        maxlength: 500,

        default: null,
      },

      rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null,
      },

      rejectedAt: {
        type: Date,

        default: null,
      },
    },

    shipment: {
      type: orderReturnShipmentSchema,

      default: () => ({}),
    },

    receipt: {
      note: {
        type: String,

        trim: true,

        default: null,

        maxlength: 1000,
      },

      receivedBy: {
        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null,
      },

      receivedAt: {
        type: Date,

        default: null,
      },
    },

    completion: {
      completedBy: {
        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null,
      },

      completedAt: {
        type: Date,

        default: null,
      },
    },

    cancellation: {
      reason: {
        type: String,

        trim: true,

        maxlength: 500,

        default: null,
      },

      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null,
      },

      cancelledAt: {
        type: Date,

        default: null,
      },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,

      immutable: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,
    },
  },

  {
    collection: "order_return_requests",

    timestamps: true,

    versionKey: false,
  },
);

/*
|--------------------------------------------------------------------------
| Validate Order Return Request
|--------------------------------------------------------------------------
|
| Mongoose 9 synchronous middleware does not use next().
|--------------------------------------------------------------------------
*/

orderReturnRequestSchema.pre("validate", function validateOrderReturnRequest() {
  const items = this.items ?? [];

  /*
    |--------------------------------------------------------------------------
    | Prevent Duplicate Order Items
    |--------------------------------------------------------------------------
    */

  const seenOrderItemIds = new Set();

  for (const item of items) {
    const orderItemId = String(item.orderItemId);

    if (seenOrderItemIds.has(orderItemId)) {
      this.invalidate(
        "items",
        "The same Order item cannot appear more than once in a return request",
      );

      break;
    }

    seenOrderItemIds.add(orderItemId);
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Inspection Quantities
    |--------------------------------------------------------------------------
    */

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    const inspection = item.inspection;

    if (!inspection) {
      continue;
    }

    const resellableQuantity = Number(inspection.resellableQuantity ?? 0);

    const damagedQuantity = Number(inspection.damagedQuantity ?? 0);

    const rejectedQuantity = Number(inspection.rejectedQuantity ?? 0);

    const inspectedQuantity =
      resellableQuantity + damagedQuantity + rejectedQuantity;

    if (inspectedQuantity > item.quantity) {
      this.invalidate(
        `items.${index}.inspection`,
        "Inspected quantities cannot exceed the requested return quantity",
      );
    }

    const inspectionCompleted =
      inspection.status === ORDER_RETURN_ITEM_INSPECTION_STATUSES.INSPECTED;

    const inspectionPending =
      inspection.status === ORDER_RETURN_ITEM_INSPECTION_STATUSES.PENDING;

    if (
      inspectionPending &&
      (inspectedQuantity !== 0 ||
        inspection.inspectedBy ||
        inspection.inspectedAt)
    ) {
      this.invalidate(
        `items.${index}.inspection`,
        "Pending inspection must not contain inspected quantities or inspection audit fields",
      );
    }

    if (inspectionCompleted && inspectedQuantity !== item.quantity) {
      this.invalidate(
        `items.${index}.inspection`,
        "Completed inspection quantities must equal the requested return quantity",
      );
    }

    if (
      inspectionCompleted &&
      (!inspection.inspectedBy || !inspection.inspectedAt)
    ) {
      this.invalidate(
        `items.${index}.inspection`,
        "Completed inspection must include inspectedBy and inspectedAt",
      );
    }
  }
});

/*
|--------------------------------------------------------------------------
| Order Return Request Indexes
|--------------------------------------------------------------------------
*/

orderReturnRequestSchema.index(
  {
    returnRequestNumber: 1,
  },
  {
    unique: true,

    name: "unique_return_request_number",
  },
);

orderReturnRequestSchema.index(
  {
    order: 1,

    createdAt: -1,
  },
  {
    name: "order_return_requests",
  },
);

orderReturnRequestSchema.index(
  {
    customer: 1,

    createdAt: -1,
  },
  {
    name: "customer_return_requests",
  },
);

orderReturnRequestSchema.index(
  {
    status: 1,

    createdAt: -1,
  },
  {
    name: "return_requests_by_status",
  },
);

orderReturnRequestSchema.index(
  {
    "items.product": 1,

    createdAt: -1,
  },
  {
    name: "product_return_history",
  },
);

const OrderReturnRequest =
  mongoose.models.OrderReturnRequest ??
  mongoose.model("OrderReturnRequest", orderReturnRequestSchema);

export default OrderReturnRequest;
