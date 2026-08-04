import OrderRefundAudit from "./order-refund-audit.model.js";

/*
|--------------------------------------------------------------------------
| Create Order Refund Audit Entry
|--------------------------------------------------------------------------
|
| The caller must pass the active transaction session.
|--------------------------------------------------------------------------
*/

export const createOrderRefundAuditEntry = async (
  refundAuditData,
  { session } = {},
) => {
  const options = {};

  if (session) {
    options.session = session;
  }

  const [refundAudit] = await OrderRefundAudit.create(
    [refundAuditData],
    options,
  );

  return refundAudit;
};
