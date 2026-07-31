import mongoose from "mongoose";

import {
  PRODUCT_INVENTORY_ADJUSTMENT_REASON_VALUES,
  PRODUCT_INVENTORY_OPERATIONS,
  PRODUCT_INVENTORY_OPERATION_VALUES,
} from "../../shared/constants/product-inventory.constants.js";

/*
|--------------------------------------------------------------------------
| Inventory State Schema
|--------------------------------------------------------------------------
|
| Stores an exact inventory snapshot before or after
| an operation.
|--------------------------------------------------------------------------
*/

const inventoryStateSchema = new mongoose.Schema(
  {
    stock: {
      type: Number,

      required: true,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Inventory stock must be a whole number",
      },
    },

    reservedStock: {
      type: Number,

      required: true,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Reserved stock must be a whole number",
      },
    },

    availableStock: {
      type: Number,

      required: true,

      min: 0,

      validate: {
        validator: Number.isInteger,

        message: "Available stock must be a whole number",
      },
    },
  },

  {
    _id: false,
  },
);

/*
|--------------------------------------------------------------------------
| Product Inventory Ledger Schema
|--------------------------------------------------------------------------
|
| Every document represents one completed inventory operation.
|
| This collection is intended to be append-only.
|--------------------------------------------------------------------------
*/

const productInventoryLedgerSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Product",

      required: true,

      immutable: true,
    },

    /*
     * Variant is an embedded Product subdocument,
     * so it does not have its own collection reference.
     */
    variantId: {
      type: mongoose.Schema.Types.ObjectId,

      required: true,

      immutable: true,
    },

    /*
     * SKU is saved as a snapshot because the Product SKU
     * could potentially be changed later.
     */
    sku: {
      type: String,

      required: true,

      trim: true,

      uppercase: true,

      maxlength: 100,

      immutable: true,
    },

    operation: {
      type: String,

      required: true,

      enum: PRODUCT_INVENTORY_OPERATION_VALUES,

      immutable: true,
    },

    /*
     * Absolute number of units involved.
     *
     * Example:
     *
     * Adjust -5 units:
     * quantity = 5
     *
     * Reserve 3 units:
     * quantity = 3
     */
    quantity: {
      type: Number,

      required: true,

      min: 1,

      immutable: true,

      validate: {
        validator: Number.isInteger,

        message: "Inventory ledger quantity must be a whole number",
      },
    },

    /*
     * Signed physical-stock change.
     *
     * Adjust +5:
     * stockDelta = 5
     *
     * Adjust -2:
     * stockDelta = -2
     *
     * Reserve:
     * stockDelta = 0
     *
     * Commit 3:
     * stockDelta = -3
     */
    stockDelta: {
      type: Number,

      required: true,

      immutable: true,

      validate: {
        validator: Number.isInteger,

        message: "Inventory stock delta must be a whole number",
      },
    },

    /*
     * Signed reserved-stock change.
     *
     * Reserve 3:
     * reservedStockDelta = 3
     *
     * Release 2:
     * reservedStockDelta = -2
     *
     * Commit 3:
     * reservedStockDelta = -3
     *
     * Physical adjustment:
     * reservedStockDelta = 0
     */
    reservedStockDelta: {
      type: Number,

      required: true,

      immutable: true,

      validate: {
        validator: Number.isInteger,

        message: "Reserved stock delta must be a whole number",
      },
    },

    before: {
      type: inventoryStateSchema,

      required: true,

      immutable: true,
    },

    after: {
      type: inventoryStateSchema,

      required: true,

      immutable: true,
    },

    /*
     * Required only for physical stock adjustments.
     */
    reason: {
      type: String,

      enum: PRODUCT_INVENTORY_ADJUSTMENT_REASON_VALUES,

      required() {
        return this.operation === PRODUCT_INVENTORY_OPERATIONS.ADJUST;
      },

      immutable: true,
    },

    note: {
      type: String,

      trim: true,

      maxlength: 300,

      immutable: true,
    },

    /*
     * Usually contains an Order ID or another
     * business-operation identifier.
     */
    referenceId: {
      type: String,

      trim: true,

      maxlength: 120,

      immutable: true,
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,

      immutable: true,
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
| Inventory Ledger Consistency Validation
|--------------------------------------------------------------------------
*/

productInventoryLedgerSchema.pre("validate", function validateLedgerEntry() {
  const before = this.before;

  const after = this.after;

  if (!before || !after) {
    return;
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Available Stock Snapshots
    |--------------------------------------------------------------------------
    */

  const expectedBeforeAvailable = before.stock - before.reservedStock;

  const expectedAfterAvailable = after.stock - after.reservedStock;

  if (before.reservedStock > before.stock) {
    this.invalidate(
      "before.reservedStock",
      "Before reserved stock cannot exceed physical stock",
    );
  }

  if (after.reservedStock > after.stock) {
    this.invalidate(
      "after.reservedStock",
      "After reserved stock cannot exceed physical stock",
    );
  }

  if (before.availableStock !== expectedBeforeAvailable) {
    this.invalidate(
      "before.availableStock",
      "Before available stock must equal stock minus reserved stock",
    );
  }

  if (after.availableStock !== expectedAfterAvailable) {
    this.invalidate(
      "after.availableStock",
      "After available stock must equal stock minus reserved stock",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Generic Delta Mathematics
    |--------------------------------------------------------------------------
    */

  if (after.stock !== before.stock + this.stockDelta) {
    this.invalidate(
      "stockDelta",
      "Stock delta does not match the before and after stock values",
    );
  }

  if (after.reservedStock !== before.reservedStock + this.reservedStockDelta) {
    this.invalidate(
      "reservedStockDelta",
      "Reserved stock delta does not match the before and after values",
    );
  }

  /*
    |--------------------------------------------------------------------------
    | Validate Operation-Specific Rules
    |--------------------------------------------------------------------------
    */

  switch (this.operation) {
    case PRODUCT_INVENTORY_OPERATIONS.ADJUST: {
      if (this.stockDelta === 0) {
        this.invalidate(
          "stockDelta",
          "Inventory adjustment stock delta cannot be zero",
        );
      }

      if (this.quantity !== Math.abs(this.stockDelta)) {
        this.invalidate(
          "quantity",
          "Adjustment quantity must equal the absolute stock delta",
        );
      }

      if (this.reservedStockDelta !== 0) {
        this.invalidate(
          "reservedStockDelta",
          "Physical stock adjustment cannot change reserved stock",
        );
      }

      break;
    }

    case PRODUCT_INVENTORY_OPERATIONS.RESERVE: {
      if (this.stockDelta !== 0) {
        this.invalidate(
          "stockDelta",
          "Stock reservation cannot change physical stock",
        );
      }

      if (this.reservedStockDelta !== this.quantity) {
        this.invalidate(
          "reservedStockDelta",
          "Reservation must increase reserved stock by the requested quantity",
        );
      }

      break;
    }

    case PRODUCT_INVENTORY_OPERATIONS.RELEASE: {
      if (this.stockDelta !== 0) {
        this.invalidate(
          "stockDelta",
          "Reservation release cannot change physical stock",
        );
      }

      if (this.reservedStockDelta !== -this.quantity) {
        this.invalidate(
          "reservedStockDelta",
          "Reservation release must reduce reserved stock by the requested quantity",
        );
      }

      break;
    }

    case PRODUCT_INVENTORY_OPERATIONS.COMMIT: {
      if (this.stockDelta !== -this.quantity) {
        this.invalidate(
          "stockDelta",
          "Inventory commit must reduce physical stock by the committed quantity",
        );
      }

      if (this.reservedStockDelta !== -this.quantity) {
        this.invalidate(
          "reservedStockDelta",
          "Inventory commit must reduce reserved stock by the committed quantity",
        );
      }

      break;
    }

    default:
      break;
  }
});

/*
|--------------------------------------------------------------------------
| Append-Only Protection
|--------------------------------------------------------------------------
|
| Ledger records must never be modified after creation.
|
| Delete operations are not blocked here so automated test cleanup,
| legal retention jobs, or environment cleanup can still remove data
| through controlled infrastructure.
|--------------------------------------------------------------------------
*/

productInventoryLedgerSchema.pre("save", function preventLedgerSaveUpdate() {
  if (!this.isNew) {
    throw new Error("Product inventory ledger entries cannot be modified");
  }
});

const blockedUpdateOperations = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
];

for (const operation of blockedUpdateOperations) {
  productInventoryLedgerSchema.pre(operation, function preventLedgerUpdate() {
    throw new Error("Product inventory ledger entries cannot be modified");
  });
}

/*
|--------------------------------------------------------------------------
| Inventory Ledger Indexes
|--------------------------------------------------------------------------
*/

productInventoryLedgerSchema.index({
  product: 1,
  variantId: 1,
  createdAt: -1,
});

productInventoryLedgerSchema.index({
  operation: 1,
  createdAt: -1,
});

productInventoryLedgerSchema.index(
  {
    referenceId: 1,
    createdAt: -1,
  },

  {
    sparse: true,
  },
);

productInventoryLedgerSchema.index({
  actor: 1,
  createdAt: -1,
});

const ProductInventoryLedger =
  mongoose.models.ProductInventoryLedger ??
  mongoose.model("ProductInventoryLedger", productInventoryLedgerSchema);

export default ProductInventoryLedger;
