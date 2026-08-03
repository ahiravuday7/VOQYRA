import { getAdminProductInventoryLedger } from "./product-inventory-ledger.service.js";

/*
|--------------------------------------------------------------------------
| Get Admin Product Inventory Ledger
|--------------------------------------------------------------------------
|
| GET
| /api/v1/admin/products/inventory-ledger
|--------------------------------------------------------------------------
*/

export const getAdminProductInventoryLedgerController = async (
  request,
  response,
) => {
  const filters = request.validated.query;

  const ledger = await getAdminProductInventoryLedger(filters);

  request.log?.info(
    {
      filters: {
        page: filters.page,

        limit: filters.limit,

        product: filters.product ?? null,

        variantId: filters.variantId ?? null,

        operation: filters.operation ?? null,

        referenceId: filters.referenceId ?? null,

        actor: filters.actor ?? null,

        from: filters.from ?? null,

        to: filters.to ?? null,

        sortDirection: filters.sortDirection,
      },

      resultCount: ledger.entries.length,

      totalItems: ledger.pagination.totalItems,

      actorUserId: request.user._id,
    },
    "Product inventory ledger retrieved",
  );

  return response.status(200).json({
    success: true,

    message: "Product inventory ledger retrieved successfully",

    data: {
      inventoryLedger: ledger.entries,

      pagination: ledger.pagination,
    },
  });
};
