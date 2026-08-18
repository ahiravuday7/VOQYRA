import { listAdminPaymentReconciliations } from "./payment.repository.js";

import { toAdminPaymentReconciliationList } from "./payment-reconciliation.admin.mapper.js";

/*
|--------------------------------------------------------------------------
| Admin Payment Reconciliation List
|--------------------------------------------------------------------------
*/

export const getAdminPaymentReconciliations = async (filters = {}) => {
  const result = await listAdminPaymentReconciliations(filters);

  return toAdminPaymentReconciliationList(result);
};
