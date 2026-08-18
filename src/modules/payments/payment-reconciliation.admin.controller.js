import { getAdminPaymentReconciliations } from "./payment-reconciliation.admin.service.js";

/*
|--------------------------------------------------------------------------
| List Payment Reconciliations
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/payment-reconciliations
|
| Provides operational visibility into:
|
| - successfully recovered Payments
| - Payments requiring manual review
|--------------------------------------------------------------------------
*/

export const getAdminPaymentReconciliationsController = async (
  request,

  response,
) => {
  /*
    |--------------------------------------------------------------------------
    | Validated Filters
    |--------------------------------------------------------------------------
    */

  const filters = request.validated.query;

  /*
    |--------------------------------------------------------------------------
    | Query Reconciliation History
    |--------------------------------------------------------------------------
    */

  const result = await getAdminPaymentReconciliations(filters);

  /*
    |--------------------------------------------------------------------------
    | Structured Operational Logging
    |--------------------------------------------------------------------------
    */

  request.log?.info(
    {
      adminId: String(request.user._id),

      resultCount: result.reconciliations.length,

      totalItems: result.pagination.totalItems,

      page: result.pagination.page,

      limit: result.pagination.limit,

      filters: {
        status: filters.status ?? null,

        reason: filters.reason ?? null,

        paymentNumber: filters.paymentNumber ?? null,

        orderNumber: filters.orderNumber ?? null,

        providerPaymentId: filters.providerPaymentId ?? null,

        from: filters.from?.toISOString?.() ?? null,

        to: filters.to?.toISOString?.() ?? null,

        sortDirection: filters.sortDirection,
      },
    },

    "Admin Payment reconciliation records retrieved",
  );

  /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

  return response.status(200).json({
    success: true,

    message: "Payment reconciliation records retrieved successfully",

    data: {
      paymentReconciliations: result.reconciliations,

      pagination: result.pagination,

      filters: {
        status: filters.status ?? null,

        reason: filters.reason ?? null,

        paymentNumber: filters.paymentNumber ?? null,

        orderNumber: filters.orderNumber ?? null,

        providerPaymentId: filters.providerPaymentId ?? null,

        from: filters.from?.toISOString?.() ?? null,

        to: filters.to?.toISOString?.() ?? null,

        sortDirection: filters.sortDirection,
      },
    },
  });
};
