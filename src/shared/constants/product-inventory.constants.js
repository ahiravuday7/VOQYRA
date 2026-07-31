/*
|--------------------------------------------------------------------------
| Product Inventory Operations
|--------------------------------------------------------------------------
*/

export const PRODUCT_INVENTORY_OPERATIONS = Object.freeze({
  ADJUST: "adjust",
  RESERVE: "reserve",
  RELEASE: "release",
  COMMIT: "commit",
});

export const PRODUCT_INVENTORY_OPERATION_VALUES = Object.freeze(
  Object.values(PRODUCT_INVENTORY_OPERATIONS),
);

/*
|--------------------------------------------------------------------------
| Product Inventory Adjustment Reasons
|--------------------------------------------------------------------------
*/

export const PRODUCT_INVENTORY_ADJUSTMENT_REASONS = Object.freeze({
  RESTOCK: "restock",

  CUSTOMER_RETURN: "customer-return",

  DAMAGE: "damage",

  SHRINKAGE: "shrinkage",

  CORRECTION: "correction",

  MANUAL_ADJUSTMENT: "manual-adjustment",
});

export const PRODUCT_INVENTORY_ADJUSTMENT_REASON_VALUES = Object.freeze(
  Object.values(PRODUCT_INVENTORY_ADJUSTMENT_REASONS),
);
