/*
|--------------------------------------------------------------------------
| Normalize Inventory Ledger Object
|--------------------------------------------------------------------------
|
| Supports:
|
| - Plain aggregation results
| - Lean objects
| - Mongoose documents
|--------------------------------------------------------------------------
*/

const normalizeLedgerObject = (ledgerEntry) => {
  if (ledgerEntry && typeof ledgerEntry.toObject === "function") {
    return ledgerEntry.toObject();
  }

  return ledgerEntry;
};

/*
|--------------------------------------------------------------------------
| Normalize Identifier
|--------------------------------------------------------------------------
*/

const normalizeIdentifier = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  /*
   * Supports a future populated document while
   * still working with a raw ObjectId.
   */
  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map Inventory State
|--------------------------------------------------------------------------
*/

const mapInventoryState = (inventoryState) => {
  if (!inventoryState) {
    return null;
  }

  return {
    stock: inventoryState.stock,

    reservedStock: inventoryState.reservedStock,

    availableStock: inventoryState.availableStock,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Product Inventory Ledger Entry
|--------------------------------------------------------------------------
*/

export const toAdminProductInventoryLedgerEntry = (ledgerEntry) => {
  const normalizedEntry = normalizeLedgerObject(ledgerEntry);

  const before = mapInventoryState(normalizedEntry.before);

  const after = mapInventoryState(normalizedEntry.after);

  return {
    id: normalizeIdentifier(normalizedEntry._id),

    productId: normalizeIdentifier(normalizedEntry.product),

    variantId: normalizeIdentifier(normalizedEntry.variantId),

    sku: normalizedEntry.sku,

    operation: normalizedEntry.operation,

    quantity: normalizedEntry.quantity,

    changes: {
      stockDelta: normalizedEntry.stockDelta,

      reservedStockDelta: normalizedEntry.reservedStockDelta,

      /*
       * Useful for displaying how customer-visible
       * availability changed during the operation.
       */
      availableStockDelta:
        after && before ? after.availableStock - before.availableStock : null,
    },

    before,

    after,

    reason: normalizedEntry.reason ?? null,

    note: normalizedEntry.note ?? null,

    referenceId: normalizedEntry.referenceId ?? null,

    actorId: normalizeIdentifier(normalizedEntry.actor),

    createdAt: normalizedEntry.createdAt,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Product Inventory Ledger List
|--------------------------------------------------------------------------
*/

export const toAdminProductInventoryLedgerList = ({ entries, pagination }) => {
  return {
    entries: entries.map((ledgerEntry) => {
      return toAdminProductInventoryLedgerEntry(ledgerEntry);
    }),

    pagination: {
      page: pagination.page,

      limit: pagination.limit,

      totalItems: pagination.totalItems,

      totalPages: pagination.totalPages,

      hasPreviousPage: pagination.hasPreviousPage,

      hasNextPage: pagination.hasNextPage,
    },
  };
};
