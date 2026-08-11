import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Payment Transaction Status
|--------------------------------------------------------------------------
|
| These represent one payment ATTEMPT.
|
| Order.payment continues to represent the current Order-level payment state.
|--------------------------------------------------------------------------
*/

export const PAYMENT_TRANSACTION_STATUSES = Object.freeze({
  CREATED: "created",

  PENDING: "pending",

  AUTHORIZED: "authorized",

  PAID: "paid",

  FAILED: "failed",

  CANCELLED: "cancelled",

  REFUNDED: "refunded",

  PARTIALLY_REFUNDED: "partially-refunded",
});

export const PAYMENT_TRANSACTION_STATUS_VALUES = Object.freeze(
  Object.values(PAYMENT_TRANSACTION_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Payment Providers
|--------------------------------------------------------------------------
|
| Provider-neutral model.
|
| We can connect Razorpay, Stripe or another provider later without changing
| the database architecture.
|--------------------------------------------------------------------------
*/

export const PAYMENT_PROVIDERS = Object.freeze({
  RAZORPAY: "razorpay",

  STRIPE: "stripe",
});

export const PAYMENT_PROVIDER_VALUES = Object.freeze(
  Object.values(PAYMENT_PROVIDERS),
);

/*
|--------------------------------------------------------------------------
| Payment Failure
|--------------------------------------------------------------------------
*/

const paymentFailureSchema = new mongoose.Schema(
  {
    code: {
      type: String,

      trim: true,

      maxlength: 200,

      default: null,
    },

    message: {
      type: String,

      trim: true,

      maxlength: 1000,

      default: null,
    },

    source: {
      type: String,

      trim: true,

      maxlength: 200,

      default: null,
    },

    step: {
      type: String,

      trim: true,

      maxlength: 200,

      default: null,
    },

    reason: {
      type: String,

      trim: true,

      maxlength: 500,

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
| Payment Refund Summary
|--------------------------------------------------------------------------
|
| Detailed Order refund audit remains in your existing refund audit models.
|
| This block tracks provider-side refund totals for the payment transaction.
|--------------------------------------------------------------------------
*/

const paymentRefundSummarySchema = new mongoose.Schema(
  {
    refundedAmount: {
      type: Number,

      required: true,

      default: 0,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Payment refunded amount must be an integer",
      },
    },

    lastRefundedAt: {
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
| Provider References
|--------------------------------------------------------------------------
|
| These identifiers come from the payment provider.
|--------------------------------------------------------------------------
*/

const paymentProviderReferenceSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,

      trim: true,

      maxlength: 300,

      default: null,
    },

    paymentId: {
      type: String,

      trim: true,

      maxlength: 300,

      default: null,
    },

    signature: {
      type: String,

      trim: true,

      maxlength: 1000,

      default: null,

      select: false,
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Payment Transaction
|--------------------------------------------------------------------------
*/

const paymentTransactionSchema = new mongoose.Schema(
  {
    /*
      |--------------------------------------------------------------------------
      | Internal Payment Reference
      |--------------------------------------------------------------------------
      |
      | Example:
      |
      | PAY-20260811-A1B2C3D4E5F6
      |--------------------------------------------------------------------------
      */

    paymentNumber: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      maxlength: 50,
    },

    /*
      |--------------------------------------------------------------------------
      | Order
      |--------------------------------------------------------------------------
      */

    order: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Order",

      required: true,
    },

    orderNumber: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      maxlength: 100,
    },

    /*
      |--------------------------------------------------------------------------
      | Customer
      |--------------------------------------------------------------------------
      */

    customer: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,
    },

    /*
      |--------------------------------------------------------------------------
      | Payment Provider
      |--------------------------------------------------------------------------
      */

    provider: {
      type: String,

      required: true,

      enum: PAYMENT_PROVIDER_VALUES,
    },

    /*
      |--------------------------------------------------------------------------
      | Amount
      |--------------------------------------------------------------------------
      |
      | Amount is stored in the same integer currency unit used by your Order.
      |
      | It must always come from trusted Order totals, NEVER from the frontend.
      |--------------------------------------------------------------------------
      */

    amount: {
      type: Number,

      required: true,

      min: 1,

      validate: {
        validator: Number.isInteger,

        message: "Payment amount must be an integer",
      },
    },

    currency: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      default: "INR",

      maxlength: 10,
    },

    /*
      |--------------------------------------------------------------------------
      | Current Attempt Status
      |--------------------------------------------------------------------------
      */

    status: {
      type: String,

      required: true,

      enum: PAYMENT_TRANSACTION_STATUS_VALUES,

      default: PAYMENT_TRANSACTION_STATUSES.CREATED,
    },

    /*
      |--------------------------------------------------------------------------
      | Attempt
      |--------------------------------------------------------------------------
      |
      | One Order may have several attempts.
      |--------------------------------------------------------------------------
      */

    attemptNumber: {
      type: Number,

      required: true,

      min: 1,

      validate: {
        validator: Number.isInteger,

        message: "Payment attempt number must be an integer",
      },
    },

    /*
      |--------------------------------------------------------------------------
      | Provider References
      |--------------------------------------------------------------------------
      */

    providerReference: {
      type: paymentProviderReferenceSchema,

      default: () => ({}),
    },

    /*
      |--------------------------------------------------------------------------
      | Payment Lifecycle
      |--------------------------------------------------------------------------
      */

    initiatedAt: {
      type: Date,

      required: true,

      default: Date.now,
    },

    authorizedAt: {
      type: Date,

      default: null,
    },

    paidAt: {
      type: Date,

      default: null,
    },

    cancelledAt: {
      type: Date,

      default: null,
    },

    /*
      |--------------------------------------------------------------------------
      | Failure
      |--------------------------------------------------------------------------
      */

    failure: {
      type: paymentFailureSchema,

      default: () => ({}),
    },

    /*
      |--------------------------------------------------------------------------
      | Refund Summary
      |--------------------------------------------------------------------------
      */

    refund: {
      type: paymentRefundSummarySchema,

      default: () => ({
        refundedAmount: 0,

        lastRefundedAt: null,
      }),
    },

    /*
      |--------------------------------------------------------------------------
      | Audit
      |--------------------------------------------------------------------------
      */

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,
    },
  },

  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Payment Transaction Indexes
|--------------------------------------------------------------------------
*/

/*
 * Internal payment reference must be globally unique.
 */

paymentTransactionSchema.index(
  {
    paymentNumber: 1,
  },
  {
    unique: true,

    name: "unique_payment_number",
  },
);

/*
 * One Order may have multiple payment attempts,
 * but attempt numbers must never repeat.
 */

paymentTransactionSchema.index(
  {
    order: 1,

    attemptNumber: 1,
  },
  {
    unique: true,

    name: "unique_order_payment_attempt",
  },
);

/*
 * Customer payment history.
 */

paymentTransactionSchema.index(
  {
    customer: 1,

    createdAt: -1,
  },
  {
    name: "customer_payment_history",
  },
);

/*
 * Admin/provider payment queues.
 */

paymentTransactionSchema.index(
  {
    status: 1,

    createdAt: -1,
  },
  {
    name: "payment_status_history",
  },
);

/*
 * Provider reconciliation.
 */

paymentTransactionSchema.index(
  {
    provider: 1,

    "providerReference.paymentId": 1,
  },
  {
    sparse: true,

    name: "provider_payment_reference",
  },
);

/*
|--------------------------------------------------------------------------
| Payment Transaction State Validation
|--------------------------------------------------------------------------
*/

paymentTransactionSchema.pre(
  "validate",

  function validatePaymentTransactionState() {
    /*
    |--------------------------------------------------------------------------
    | Paid
    |--------------------------------------------------------------------------
    */

    if (this.status === PAYMENT_TRANSACTION_STATUSES.PAID && !this.paidAt) {
      this.invalidate(
        "paidAt",

        "A paid Payment transaction must contain paidAt",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Failed
    |--------------------------------------------------------------------------
    */

    if (
      this.status === PAYMENT_TRANSACTION_STATUSES.FAILED &&
      !this.failure?.failedAt
    ) {
      this.invalidate(
        "failure.failedAt",

        "A failed Payment transaction must contain failure.failedAt",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Cancelled
    |--------------------------------------------------------------------------
    */

    if (
      this.status === PAYMENT_TRANSACTION_STATUSES.CANCELLED &&
      !this.cancelledAt
    ) {
      this.invalidate(
        "cancelledAt",

        "A cancelled Payment transaction must contain cancelledAt",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Refund Amount
    |--------------------------------------------------------------------------
    */

    const refundedAmount = this.refund?.refundedAmount ?? 0;

    if (refundedAmount > this.amount) {
      this.invalidate(
        "refund.refundedAmount",

        "Refunded amount cannot exceed the Payment amount",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Fully Refunded
    |--------------------------------------------------------------------------
    */

    if (
      this.status === PAYMENT_TRANSACTION_STATUSES.REFUNDED &&
      refundedAmount !== this.amount
    ) {
      this.invalidate(
        "refund.refundedAmount",

        "A refunded Payment transaction must be fully refunded",
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Partially Refunded
    |--------------------------------------------------------------------------
    */

    if (
      this.status === PAYMENT_TRANSACTION_STATUSES.PARTIALLY_REFUNDED &&
      (refundedAmount <= 0 || refundedAmount >= this.amount)
    ) {
      this.invalidate(
        "refund.refundedAmount",

        "A partially refunded Payment must have a refund amount greater than zero and less than the Payment amount",
      );
    }
  },
);

/*
|--------------------------------------------------------------------------
| Payment Transaction Model
|--------------------------------------------------------------------------
*/

const PaymentTransaction = mongoose.model(
  "PaymentTransaction",

  paymentTransactionSchema,
);

export default PaymentTransaction;
