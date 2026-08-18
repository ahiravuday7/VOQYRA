/*
|--------------------------------------------------------------------------
| Normalize
|--------------------------------------------------------------------------
*/

const normalizeObject = (value) => {
  if (value && typeof value.toObject === "function") {
    return value.toObject();
  }

  return value;
};

/*
|--------------------------------------------------------------------------
| Identifier
|--------------------------------------------------------------------------
*/

const normalizeIdentifier = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Admin Payment Reconciliation
|--------------------------------------------------------------------------
|
| Safe operational representation.
|
| Deliberately excluded:
|
| - provider signature
| - raw provider payload
| - createdBy internals
| - sensitive provider verification details
|--------------------------------------------------------------------------
*/

export const toAdminPaymentReconciliation = (paymentTransaction) => {
  const payment = normalizeObject(paymentTransaction);

  if (!payment) {
    return null;
  }

  return {
    id: normalizeIdentifier(payment._id),

    paymentNumber: payment.paymentNumber,

    orderId: normalizeIdentifier(payment.order),

    orderNumber: payment.orderNumber,

    customerId: normalizeIdentifier(payment.customer),

    provider: payment.provider,

    providerPaymentId: payment.providerReference?.paymentId ?? null,

    providerOrderId: payment.providerReference?.orderId ?? null,

    amount: payment.amount,

    currency: payment.currency,

    paymentStatus: payment.status,

    reconciliation: {
      status: payment.reconciliation?.status ?? null,

      reason: payment.reconciliation?.reason ?? null,

      detectedAt: payment.reconciliation?.detectedAt ?? null,

      lastAttemptedAt: payment.reconciliation?.lastAttemptedAt ?? null,

      attemptCount: payment.reconciliation?.attemptCount ?? 0,

      recoveredAt: payment.reconciliation?.recoveredAt ?? null,
    },

    paymentLifecycle: {
      verifiedAt: payment.verifiedAt ?? null,

      providerVerifiedAt: payment.providerVerifiedAt ?? null,

      paidAt: payment.paidAt ?? null,
    },

    createdAt: payment.createdAt ?? null,

    updatedAt: payment.updatedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Payment Reconciliation List
|--------------------------------------------------------------------------
*/

export const toAdminPaymentReconciliationList = ({
  paymentTransactions,

  pagination,
}) => {
  return {
    reconciliations: paymentTransactions.map((paymentTransaction) => {
      return toAdminPaymentReconciliation(paymentTransaction);
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
