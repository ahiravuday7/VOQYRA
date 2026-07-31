import ProductInventoryLedger from "./product-inventory-ledger.model.js";

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
