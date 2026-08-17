import mongoose from "mongoose";

import {
  MAX_ORDER_ITEMS,
  MAX_ORDER_ITEM_QUANTITY,
  ORDER_CURRENCIES,
  ORDER_CURRENCY_VALUES,
  ORDER_INVENTORY_STATUSES,
  ORDER_INVENTORY_STATUS_VALUES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_METHOD_VALUES,
  ORDER_PAYMENT_STATUSES,
  ORDER_PAYMENT_STATUS_VALUES,
  ORDER_STATUSES,
  ORDER_STATUS_VALUES,
} from "../../shared/constants/order.constants.js";

import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ACTOR_TYPE_VALUES,
  SYSTEM_AUDIT_ACTOR_VALUES,
} from "../../shared/constants/audit.constants.js";

/*
|--------------------------------------------------------------------------
| Integer Validator
|--------------------------------------------------------------------------
*/

const integerValidator = {
  validator: Number.isInteger,

  message: "{PATH} must be a whole number",
};

/*
|--------------------------------------------------------------------------
| Order Item Colour Snapshot
|--------------------------------------------------------------------------
*/

const orderItemColorSchema = new mongoose.Schema(
  {
    name: {
      type: String,

      required: true,

      trim: true,

      maxlength: 100,
    },

    code: {
      type: String,

      trim: true,

      uppercase: true,

      maxlength: 20,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Item Image Snapshot
|--------------------------------------------------------------------------
*/

const orderItemImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,

      required: true,

      trim: true,

      maxlength: 2048,
    },

    altText: {
      type: String,

      trim: true,

      maxlength: 200,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Item Pricing Snapshot
|--------------------------------------------------------------------------
|
| Prices must be copied from the Product database.
| The customer must never be allowed to submit trusted prices.
|--------------------------------------------------------------------------
*/

const orderItemPricingSchema = new mongoose.Schema(
  {
    currency: {
      type: String,

      required: true,

      enum: ORDER_CURRENCY_VALUES,

      default: ORDER_CURRENCIES.INR,
    },

    /*
     * Original variant selling price.
     */
    unitSellingPrice: {
      type: Number,

      required: true,

      min: 0,

      validate: integerValidator,
    },

    /*
     * Variant discount price at checkout.
     * Null means no discount existed.
     */
    unitDiscountPrice: {
      type: Number,

      default: null,

      min: 0,

      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },

        message: "Unit discount price must be a whole number",
      },
    },

    /*
     * Actual price charged per item.
     *
     * unitFinalPrice =
     * discountPrice ?? sellingPrice
     */
    unitFinalPrice: {
      type: Number,

      required: true,

      min: 0,

      validate: integerValidator,
    },

    /*
     * Discount applied to one unit.
     *
     * unitSellingPrice - unitFinalPrice
     */
    discountPerUnit: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },

    /*
     * unitFinalPrice × quantity
     */
    lineSubtotal: {
      type: Number,

      required: true,

      min: 0,

      validate: integerValidator,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Item Inventory State
|--------------------------------------------------------------------------
|
| Tracks how inventory for an individual Order item
| progressed through reservation, release, or commit.
|--------------------------------------------------------------------------
*/

const orderItemInventorySchema = new mongoose.Schema(
  {
    status: {
      type: String,

      required: true,

      enum: ORDER_INVENTORY_STATUS_VALUES,

      default: ORDER_INVENTORY_STATUSES.PENDING,
    },

    reservedQuantity: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },

    committedQuantity: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },

    releasedQuantity: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Item Schema
|--------------------------------------------------------------------------
|
| Each Order item stores snapshots so historical Orders
| remain accurate even when Product data changes later.
|--------------------------------------------------------------------------
*/

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Product",

      required: true,

      immutable: true,
    },

    /*
     * Product variants are embedded documents,
     * so variantId does not have a collection ref.
     */
    variantId: {
      type: mongoose.Schema.Types.ObjectId,

      required: true,

      immutable: true,
    },

    sku: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      maxlength: 100,

      immutable: true,
    },

    productName: {
      type: String,

      required: true,

      trim: true,

      maxlength: 200,

      immutable: true,
    },

    productSlug: {
      type: String,

      required: true,

      trim: true,

      lowercase: true,

      maxlength: 200,

      immutable: true,
    },

    size: {
      type: String,

      required: true,

      trim: true,

      maxlength: 50,

      immutable: true,
    },

    color: {
      type: orderItemColorSchema,

      required: true,

      immutable: true,
    },

    image: {
      type: orderItemImageSchema,

      required: true,

      immutable: true,
    },

    quantity: {
      type: Number,

      required: true,

      min: 1,

      max: MAX_ORDER_ITEM_QUANTITY,

      immutable: true,

      validate: integerValidator,
    },

    pricing: {
      type: orderItemPricingSchema,

      required: true,

      immutable: true,
    },

    inventory: {
      type: orderItemInventorySchema,

      required: true,

      default: () => ({
        status: ORDER_INVENTORY_STATUSES.PENDING,

        reservedQuantity: 0,
        committedQuantity: 0,
        releasedQuantity: 0,
      }),
    },
  },

  {
    _id: true,
  },
);

/*
|--------------------------------------------------------------------------
| Order Shipping Address
|--------------------------------------------------------------------------
|
| The address is copied into the Order.
|
| Future edits to the customer's saved address must not
| modify previously created Orders.
|--------------------------------------------------------------------------
*/

const orderAddressSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,

      required: true,

      trim: true,

      maxlength: 150,
    },

    phone: {
      type: String,

      required: true,

      trim: true,

      maxlength: 20,
    },

    alternatePhone: {
      type: String,

      trim: true,

      maxlength: 20,
    },

    email: {
      type: String,

      trim: true,

      lowercase: true,

      maxlength: 254,
    },

    addressLine1: {
      type: String,

      required: true,

      trim: true,

      maxlength: 250,
    },

    addressLine2: {
      type: String,

      trim: true,

      maxlength: 250,
    },

    landmark: {
      type: String,

      trim: true,

      maxlength: 150,
    },

    city: {
      type: String,

      required: true,

      trim: true,

      maxlength: 100,
    },

    state: {
      type: String,

      required: true,

      trim: true,

      maxlength: 100,
    },

    postalCode: {
      type: String,

      required: true,

      trim: true,

      maxlength: 20,
    },

    country: {
      type: String,

      required: true,

      trim: true,

      maxlength: 100,

      default: "India",
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Pricing Totals
|--------------------------------------------------------------------------
*/

const orderTotalsSchema = new mongoose.Schema(
  {
    currency: {
      type: String,

      required: true,

      enum: ORDER_CURRENCY_VALUES,

      default: ORDER_CURRENCIES.INR,
    },

    /*
     * Sum of all item line subtotals.
     */
    itemsSubtotal: {
      type: Number,

      required: true,

      min: 0,

      validate: integerValidator,
    },

    /*
     * Future coupon or promotional discount.
     */
    discountAmount: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },

    shippingAmount: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },

    taxAmount: {
      type: Number,

      required: true,

      min: 0,

      default: 0,

      validate: integerValidator,
    },

    grandTotal: {
      type: Number,

      required: true,

      min: 0,

      validate: integerValidator,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Order Payment
|--------------------------------------------------------------------------
*/

const orderPaymentSchema = new mongoose.Schema(
  {
    method: {
      type: String,

      required: true,

      enum: ORDER_PAYMENT_METHOD_VALUES,

      default: ORDER_PAYMENT_METHODS.CASH_ON_DELIVERY,
    },

    status: {
      type: String,

      required: true,

      enum: ORDER_PAYMENT_STATUS_VALUES,

      default: ORDER_PAYMENT_STATUSES.PENDING,
    },

    provider: {
      type: String,

      trim: true,

      maxlength: 100,
    },

    transactionId: {
      type: String,

      trim: true,

      maxlength: 200,
    },

    paidAt: {
      type: Date,

      default: null,
    },

    failedAt: {
      type: Date,

      default: null,
    },

    refundedAt: {
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
| Order Shipment
|--------------------------------------------------------------------------
*/

const orderShipmentSchema = new mongoose.Schema(
  {
    carrier: {
      type: String,

      trim: true,

      maxlength: 100,
    },

    trackingNumber: {
      type: String,

      trim: true,

      maxlength: 150,
    },

    trackingUrl: {
      type: String,

      trim: true,

      maxlength: 2048,
    },

    shippedAt: {
      type: Date,

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
| Order Refund Snapshot
|--------------------------------------------------------------------------
|
| Stores the completed refund summary directly on the Order.
|
| The separate OrderRefundAudit model created below provides the
| immutable financial audit record.
|--------------------------------------------------------------------------
*/

const orderRefundSchema = new mongoose.Schema(
  {
    reason: {
      type: String,

      required: true,

      trim: true,

      minlength: 5,

      maxlength: 500,
    },

    referenceId: {
      type: String,

      required: true,

      trim: true,

      minlength: 3,

      maxlength: 200,
    },

    amount: {
      type: Number,

      required: true,

      min: 0.01,
    },

    currency: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,
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
    _id: false,
  },
);
/*
|--------------------------------------------------------------------------
| Order Status History
|--------------------------------------------------------------------------
*/

const orderStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,

      required: true,

      enum: ORDER_STATUS_VALUES,
    },

    note: {
      type: String,

      trim: true,

      maxlength: 500,
    },

    /*
|--------------------------------------------------------------------------
| Status Change Actor
|--------------------------------------------------------------------------
*/

    changedByType: {
      type: String,

      required: true,

      enum: AUDIT_ACTOR_TYPE_VALUES,

      default: AUDIT_ACTOR_TYPES.USER,
    },

    changedBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      default: null,

      required: function () {
        return this.changedByType === AUDIT_ACTOR_TYPES.USER;
      },
    },

    systemActor: {
      type: String,

      default: null,

      enum: [...SYSTEM_AUDIT_ACTOR_VALUES, null],

      required: function () {
        return this.changedByType === AUDIT_ACTOR_TYPES.SYSTEM;
      },
    },

    changedAt: {
      type: Date,

      required: true,

      default: Date.now,
    },
  },

  {
    _id: true,
  },
);

/*
|--------------------------------------------------------------------------
| Order Schema
|--------------------------------------------------------------------------
*/

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      maxlength: 50,

      immutable: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,

      immutable: true,
    },

    items: {
      type: [orderItemSchema],

      required: true,

      validate: [
        {
          validator(items) {
            return Array.isArray(items) && items.length >= 1;
          },

          message: "Order must contain at least one item",
        },

        {
          validator(items) {
            return Array.isArray(items) && items.length <= MAX_ORDER_ITEMS;
          },

          message: `Order cannot contain more than ${MAX_ORDER_ITEMS} items`,
        },
      ],
    },

    shippingAddress: {
      type: orderAddressSchema,

      required: true,
    },

    totals: {
      type: orderTotalsSchema,

      required: true,
    },

    payment: {
      type: orderPaymentSchema,

      required: true,

      default: () => ({
        method: ORDER_PAYMENT_METHODS.CASH_ON_DELIVERY,

        status: ORDER_PAYMENT_STATUSES.PENDING,
      }),
    },

    shipment: {
      type: orderShipmentSchema,

      default: () => ({}),
    },

    status: {
      type: String,

      required: true,

      enum: ORDER_STATUS_VALUES,

      default: ORDER_STATUSES.PENDING,
    },

    inventoryStatus: {
      type: String,

      required: true,

      enum: ORDER_INVENTORY_STATUS_VALUES,

      default: ORDER_INVENTORY_STATUSES.PENDING,
    },

    /*
|--------------------------------------------------------------------------
| Inventory Reservation Expiry
|--------------------------------------------------------------------------
|
| Only online Orders receive a reservation expiry.
|
| Example:
|
| Order created at:  14:30
| Expiry:            15:00
|
| COD Orders currently keep this field null.
|--------------------------------------------------------------------------
*/

    inventoryReservationExpiresAt: {
      type: Date,

      default: null,
    },

    statusHistory: {
      type: [orderStatusHistorySchema],

      default: [],
    },

    customerNote: {
      type: String,

      trim: true,

      maxlength: 500,
    },

    adminNote: {
      type: String,

      trim: true,

      maxlength: 1000,
    },

    cancellation: {
      reason: {
        type: String,

        trim: true,

        maxlength: 500,
      },

      cancelledAt: {
        type: Date,

        default: null,
      },

      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null,
      },
    },

    returnRequestVersion: {
      type: Number,

      default: 0,

      min: 0,

      select: false,
    },

    refund: {
      type: orderRefundSchema,

      default: undefined,
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
    timestamps: true,

    versionKey: false,
  },
);

/*
|--------------------------------------------------------------------------
| Validate Completed Refund State
|--------------------------------------------------------------------------
|
| Mongoose 9 synchronous middleware does not use next().
|--------------------------------------------------------------------------
*/

orderSchema.pre("validate", function validateCompletedRefundState() {
  const hasRefund = Boolean(this.refund);

  const orderIsRefunded = this.status === ORDER_STATUSES.REFUNDED;

  const paymentIsRefunded =
    this.payment?.status === ORDER_PAYMENT_STATUSES.REFUNDED;

  /*
   * Normal non-refunded Order.
   */
  if (!hasRefund && !orderIsRefunded && !paymentIsRefunded) {
    return;
  }

  if (!orderIsRefunded) {
    this.invalidate(
      "status",
      "An Order with refund information must have refunded status",
    );
  }

  if (!paymentIsRefunded) {
    this.invalidate(
      "payment.status",
      "A refunded Order must have refunded payment status",
    );
  }

  if (!hasRefund) {
    this.invalidate(
      "refund",
      "A refunded Order must contain refund audit information",
    );

    return;
  }

  if (!this.payment?.refundedAt) {
    this.invalidate(
      "payment.refundedAt",
      "A refunded payment must contain refundedAt",
    );
  }

  const orderGrandTotal = Number(this.totals?.grandTotal);

  const refundAmount = Number(this.refund?.amount);

  if (
    !Number.isFinite(orderGrandTotal) ||
    !Number.isFinite(refundAmount) ||
    refundAmount !== orderGrandTotal
  ) {
    this.invalidate(
      "refund.amount",
      "Refund amount must match the Order grand total",
    );
  }

  if (this.refund?.currency !== this.totals?.currency) {
    this.invalidate(
      "refund.currency",
      "Refund currency must match the Order currency",
    );
  }

  const paymentRefundedAt = this.payment?.refundedAt
    ? new Date(this.payment.refundedAt).getTime()
    : null;

  const auditRefundedAt = this.refund?.refundedAt
    ? new Date(this.refund.refundedAt).getTime()
    : null;

  if (
    !paymentRefundedAt ||
    !auditRefundedAt ||
    paymentRefundedAt !== auditRefundedAt
  ) {
    this.invalidate(
      "refund.refundedAt",
      "Payment and refund audit timestamps must match",
    );
  }
});

/*
|--------------------------------------------------------------------------
| Order Consistency Validation
|--------------------------------------------------------------------------
*/

orderSchema.pre("validate", function validateOrderConsistency() {
  const items = this.items ?? [];

  /*
    |--------------------------------------------------------------------------
    | Prevent Duplicate Product Variants
    |--------------------------------------------------------------------------
    |
    | The same variant should be represented by one item
    | whose quantity contains the complete requested amount.
    |--------------------------------------------------------------------------
    */

  const itemKeys = items.map((item) => {
    return `${String(item.product)}:` + `${String(item.variantId)}`;
  });

  if (new Set(itemKeys).size !== itemKeys.length) {
    this.invalidate("items", "Order cannot contain duplicate Product variants");
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Item Pricing
    |--------------------------------------------------------------------------
    */

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    const pricing = item.pricing;

    if (!pricing) {
      continue;
    }

    if (pricing.unitFinalPrice > pricing.unitSellingPrice) {
      this.invalidate(
        `items.${index}.pricing.unitFinalPrice`,
        "Final unit price cannot exceed the selling price",
      );
    }

    const expectedDiscountPerUnit =
      pricing.unitSellingPrice - pricing.unitFinalPrice;

    if (pricing.discountPerUnit !== expectedDiscountPerUnit) {
      this.invalidate(
        `items.${index}.pricing.discountPerUnit`,
        "Discount per unit does not match the selling and final prices",
      );
    }

    const expectedLineSubtotal = pricing.unitFinalPrice * item.quantity;

    if (pricing.lineSubtotal !== expectedLineSubtotal) {
      this.invalidate(
        `items.${index}.pricing.lineSubtotal`,
        "Order item subtotal must equal final unit price multiplied by quantity",
      );
    }

    /*
      |--------------------------------------------------------------------------
      | Validate Item Inventory State
      |--------------------------------------------------------------------------
      */

    const inventory = item.inventory;

    if (!inventory) {
      continue;
    }

    switch (inventory.status) {
      case ORDER_INVENTORY_STATUSES.PENDING: {
        if (
          inventory.reservedQuantity !== 0 ||
          inventory.committedQuantity !== 0 ||
          inventory.releasedQuantity !== 0
        ) {
          this.invalidate(
            `items.${index}.inventory`,
            "Pending Order inventory cannot contain processed quantities",
          );
        }

        break;
      }

      case ORDER_INVENTORY_STATUSES.RESERVED: {
        if (
          inventory.reservedQuantity !== item.quantity ||
          inventory.committedQuantity !== 0 ||
          inventory.releasedQuantity !== 0
        ) {
          this.invalidate(
            `items.${index}.inventory`,
            "Reserved Order inventory must reserve the complete item quantity",
          );
        }

        break;
      }

      case ORDER_INVENTORY_STATUSES.COMMITTED: {
        if (
          inventory.reservedQuantity !== 0 ||
          inventory.committedQuantity !== item.quantity ||
          inventory.releasedQuantity !== 0
        ) {
          this.invalidate(
            `items.${index}.inventory`,
            "Committed Order inventory must commit the complete item quantity",
          );
        }

        break;
      }

      case ORDER_INVENTORY_STATUSES.RELEASED: {
        if (
          inventory.reservedQuantity !== 0 ||
          inventory.committedQuantity !== 0 ||
          inventory.releasedQuantity !== item.quantity
        ) {
          this.invalidate(
            `items.${index}.inventory`,
            "Released Order inventory must release the complete item quantity",
          );
        }

        break;
      }

      default:
        break;
    }
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Order Totals
    |--------------------------------------------------------------------------
    */

  if (this.totals) {
    const expectedItemsSubtotal = items.reduce((total, item) => {
      return total + (item.pricing?.lineSubtotal ?? 0);
    }, 0);

    if (this.totals.itemsSubtotal !== expectedItemsSubtotal) {
      this.invalidate(
        "totals.itemsSubtotal",
        "Order items subtotal does not match the item pricing",
      );
    }

    const expectedGrandTotal =
      this.totals.itemsSubtotal -
      this.totals.discountAmount +
      this.totals.shippingAmount +
      this.totals.taxAmount;

    if (this.totals.grandTotal !== expectedGrandTotal) {
      this.invalidate(
        "totals.grandTotal",
        "Order grand total does not match the calculated amount",
      );
    }
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Order-Level Inventory Status
    |--------------------------------------------------------------------------
    */

  if (items.length > 0) {
    const allItemsMatchOrderInventoryStatus = items.every((item) => {
      return item.inventory?.status === this.inventoryStatus;
    });

    if (!allItemsMatchOrderInventoryStatus) {
      this.invalidate(
        "inventoryStatus",
        "Order inventory status must match every Order item",
      );
    }
  }
});

/*
|--------------------------------------------------------------------------
| Order Indexes
|--------------------------------------------------------------------------
*/

orderSchema.index(
  {
    orderNumber: 1,
  },
  {
    unique: true,
  },
);

orderSchema.index({
  customer: 1,
  createdAt: -1,
});

orderSchema.index({
  status: 1,
  createdAt: -1,
});

orderSchema.index({
  inventoryStatus: 1,
  createdAt: -1,
});

orderSchema.index({
  "payment.status": 1,
  createdAt: -1,
});

orderSchema.index(
  {
    "payment.transactionId": 1,
  },
  {
    sparse: true,
  },
);

orderSchema.index({
  "items.product": 1,
  createdAt: -1,
});

orderSchema.index({
  "items.variantId": 1,
  createdAt: -1,
});

/*
|--------------------------------------------------------------------------
| Online Inventory Reservation Expiry
|--------------------------------------------------------------------------
|
| Future expiry worker query:
|
| pending Order
| online payment
| unpaid
| reserved inventory
| expiry <= now
|--------------------------------------------------------------------------
*/

orderSchema.index(
  {
    status: 1,

    "payment.method": 1,

    "payment.status": 1,

    inventoryStatus: 1,

    inventoryReservationExpiresAt: 1,
  },

  {
    name: "order_online_inventory_reservation_expiry",
  },
);

/*
|--------------------------------------------------------------------------
| Order Model
|--------------------------------------------------------------------------
*/

const Order = mongoose.models.Order ?? mongoose.model("Order", orderSchema);

export default Order;
