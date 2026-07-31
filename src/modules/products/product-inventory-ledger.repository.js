import mongoose from "mongoose";
import ProductInventoryLedger from "./product-inventory-ledger.model.js";

/*
|--------------------------------------------------------------------------
| Normalize Inventory Ledger ObjectId
|--------------------------------------------------------------------------
*/

const normalizeInventoryLedgerObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
};
/*
|--------------------------------------------------------------------------
| Create Product Inventory Ledger Entry
|--------------------------------------------------------------------------
|
| The array form of Model.create() is used because Mongoose
| requires it when passing a transaction session.
|--------------------------------------------------------------------------
*/

export const createProductInventoryLedgerEntry = async (
  ledgerData,
  session,
) => {
  const [ledgerEntry] = await ProductInventoryLedger.create([ledgerData], {
    session,
  });

  return ledgerEntry;
};

/*
|--------------------------------------------------------------------------
| Build Product Inventory Ledger Match Filter
|--------------------------------------------------------------------------
*/

const buildProductInventoryLedgerMatchFilter = ({
  product,
  variantId,
  operation,
  referenceId,
  actor,
  from,
  to,
} = {}) => {
  const match = {};

  if (product) {
    match.product = normalizeInventoryLedgerObjectId(product);
  }

  if (variantId) {
    match.variantId = normalizeInventoryLedgerObjectId(variantId);
  }

  if (operation) {
    match.operation = operation;
  }

  if (referenceId) {
    match.referenceId = referenceId;
  }

  if (actor) {
    match.actor = normalizeInventoryLedgerObjectId(actor);
  }

  if (from || to) {
    match.createdAt = {};

    if (from) {
      match.createdAt.$gte = from;
    }

    if (to) {
      match.createdAt.$lte = to;
    }
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| List Product Inventory Ledger Entries
|--------------------------------------------------------------------------
*/

export const listProductInventoryLedgerEntries = async (filters = {}) => {
  const { page = 1, limit = 20, sortDirection = "desc" } = filters;

  const skip = (page - 1) * limit;

  const normalizedSortDirection = sortDirection === "asc" ? 1 : -1;

  const matchFilter = buildProductInventoryLedgerMatchFilter(filters);

  /*
   * $facet returns both paginated entries
   * and total count from the same filtered set.
   */
  const [result] = await ProductInventoryLedger.aggregate([
    {
      $match: matchFilter,
    },

    {
      $facet: {
        entries: [
          {
            $sort: {
              createdAt: normalizedSortDirection,

              /*
               * Stable ordering when multiple
               * entries share a timestamp.
               */
              _id: normalizedSortDirection,
            },
          },

          {
            $skip: skip,
          },

          {
            $limit: limit,
          },
        ],

        metadata: [
          {
            $count: "totalItems",
          },
        ],
      },
    },
  ]);

  const entries = result?.entries ?? [];

  const totalItems = result?.metadata?.[0]?.totalItems ?? 0;

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

  return {
    entries,

    pagination: {
      page,
      limit,
      totalItems,
      totalPages,

      hasPreviousPage: page > 1,

      hasNextPage: page < totalPages,
    },
  };
};
