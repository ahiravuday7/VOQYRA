import { listProductInventoryLedgerEntries } from "./product-inventory-ledger.repository.js";

import { toAdminProductInventoryLedgerList } from "./product-inventory-ledger.mapper.js";

/*
|--------------------------------------------------------------------------
| Get Admin Product Inventory Ledger
|--------------------------------------------------------------------------
|
| Validation has already normalized:
|
| - page
| - limit
| - ObjectId values
| - operation
| - dates
| - sort direction
|--------------------------------------------------------------------------
*/

export const getAdminProductInventoryLedger = async (filters = {}) => {
  const result = await listProductInventoryLedgerEntries(filters);

  return toAdminProductInventoryLedgerList(result);
};
