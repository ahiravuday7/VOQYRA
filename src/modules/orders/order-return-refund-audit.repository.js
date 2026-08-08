import mongoose from "mongoose";

import OrderReturnRefundAudit from "./order-return-refund-audit.model.js";

/*
|--------------------------------------------------------------------------
| Create Order Return Refund Audit
|--------------------------------------------------------------------------
*/

export const createOrderReturnRefundAuditEntry = async (
  auditData,
  { session = null } = {},
) => {
  const options = session
    ? {
        session,
      }
    : {};

  const [audit] = await OrderReturnRefundAudit.create([auditData], options);

  return audit;
};

/*
|--------------------------------------------------------------------------
| Get Cumulative Return Refund Totals for Order
|--------------------------------------------------------------------------
*/

export const getOrderReturnRefundTotals = async (
  orderId,
  { session = null } = {},
) => {
  const normalizedOrderId =
    orderId instanceof mongoose.Types.ObjectId
      ? orderId
      : new mongoose.Types.ObjectId(orderId);

  const aggregate = OrderReturnRefundAudit.aggregate([
    {
      $match: {
        order: normalizedOrderId,
      },
    },

    {
      $group: {
        _id: null,

        totalRefundAmount: {
          $sum: "$amount",
        },

        totalRefundedQuantity: {
          $sum: "$refundedQuantity",
        },

        refundCount: {
          $sum: 1,
        },
      },
    },
  ]);

  if (session) {
    aggregate.session(session);
  }

  const [totals] = await aggregate;

  return {
    totalRefundAmount: Number(totals?.totalRefundAmount ?? 0),

    totalRefundedQuantity: Number(totals?.totalRefundedQuantity ?? 0),

    refundCount: Number(totals?.refundCount ?? 0),
  };
};
