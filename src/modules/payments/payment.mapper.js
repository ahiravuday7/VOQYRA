/*
|--------------------------------------------------------------------------
| Normalize Payment Transaction
|--------------------------------------------------------------------------
*/

const normalizePaymentTransaction = (paymentTransaction) => {
  if (!paymentTransaction) {
    return null;
  }

  if (typeof paymentTransaction.toObject === "function") {
    return paymentTransaction.toObject();
  }

  return paymentTransaction;
};

/*
|--------------------------------------------------------------------------
| Normalize ObjectId
|--------------------------------------------------------------------------
*/

const normalizeId = (value) => {
  if (!value) {
    return null;
  }

  return String(value._id ?? value);
};

/*
|--------------------------------------------------------------------------
| Customer Payment Transaction
|--------------------------------------------------------------------------
|
| Customer-safe representation.
|
| Deliberately hidden:
|
| createdBy
| providerReference.signature
| internal provider failure details
|--------------------------------------------------------------------------
*/

export const mapCustomerPaymentTransaction = (paymentTransaction) => {
  const payment = normalizePaymentTransaction(paymentTransaction);

  if (!payment) {
    return null;
  }

  return {
    id: normalizeId(payment._id),

    paymentNumber: payment.paymentNumber,

    orderId: normalizeId(payment.order),

    orderNumber: payment.orderNumber,

    provider: payment.provider,

    amount: payment.amount,

    currency: payment.currency,

    status: payment.status,

    attemptNumber: payment.attemptNumber,

    /*
      |--------------------------------------------------------------------------
      | Provider References
      |--------------------------------------------------------------------------
      |
      | Provider order/payment IDs are safe and will later be useful to the
      | frontend.
      |
      | Signature is intentionally NOT mapped.
      |--------------------------------------------------------------------------
      */

    providerReference: {
      orderId: payment.providerReference?.orderId ?? null,

      paymentId: payment.providerReference?.paymentId ?? null,
    },

    /*
      |--------------------------------------------------------------------------
      | Lifecycle
      |--------------------------------------------------------------------------
      */

    initiatedAt: payment.initiatedAt ?? null,

    authorizedAt: payment.authorizedAt ?? null,

    paidAt: payment.paidAt ?? null,

    cancelledAt: payment.cancelledAt ?? null,

    /*
      |--------------------------------------------------------------------------
      | Refund Summary
      |--------------------------------------------------------------------------
      */

    refund: {
      refundedAmount: payment.refund?.refundedAmount ?? 0,

      lastRefundedAt: payment.refund?.lastRefundedAt ?? null,
    },

    createdAt: payment.createdAt ?? null,

    updatedAt: payment.updatedAt ?? null,
  };
};
