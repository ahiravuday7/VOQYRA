import {
  ORDER_RETURN_RESOLUTION_VALUES,
  ORDER_RETURN_STATUS_VALUES,
} from "../../shared/constants/order.constants.js";

import { ORDER_RETURN_REPLACEMENT_STATUS_VALUES } from "./order-return-replacement.model.js";

import { aggregateAdminOrderReturnMetrics } from "./order-return.repository.js";

import { aggregateAdminOrderReturnReplacementMetrics } from "./order-return-replacement.repository.js";

/*
|--------------------------------------------------------------------------
| Create Zero Count Map
|--------------------------------------------------------------------------
|
| Example:
|
| [
|   "requested",
|   "approved",
|   "completed"
| ]
|
| becomes:
|
| {
|   requested: 0,
|   approved: 0,
|   completed: 0
| }
|--------------------------------------------------------------------------
*/

const createZeroCountMap = (values) => {
  return Object.fromEntries(values.map((value) => [value, 0]));
};

/*
|--------------------------------------------------------------------------
| Normalize Aggregation Counts
|--------------------------------------------------------------------------
*/

const normalizeGroupedCounts = (values, aggregationRows = []) => {
  const counts = createZeroCountMap(values);

  for (const row of aggregationRows) {
    if (row?._id && Object.hasOwn(counts, row._id)) {
      counts[row._id] = Number(row.count ?? 0);
    }
  }

  return counts;
};

/*
|--------------------------------------------------------------------------
| Read Facet Count
|--------------------------------------------------------------------------
*/

const readFacetCount = (facet) => {
  return Number(facet?.[0]?.count ?? 0);
};

/*
|--------------------------------------------------------------------------
| Build Metrics CreatedAt Range
|--------------------------------------------------------------------------
|
| API dates represent UTC calendar days.
|--------------------------------------------------------------------------
*/

const buildMetricsCreatedAtRange = ({ from, to }) => {
  if (!from && !to) {
    return null;
  }

  const range = {};

  if (from) {
    range.$gte = new Date(`${from}T00:00:00.000Z`);
  }

  if (to) {
    range.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  return range;
};

/*
|--------------------------------------------------------------------------
| Get Admin Return / Replacement Operational Metrics
|--------------------------------------------------------------------------
*/

export const getAdminOrderReturnOperationalMetrics = async ({
  from,
  to,
} = {}) => {
  const createdAtRange = buildMetricsCreatedAtRange({
    from,
    to,
  });

  /*
    |--------------------------------------------------------------------------
    | Execute Independent Aggregations Together
    |--------------------------------------------------------------------------
    */

  const [returnMetrics, replacementMetrics] = await Promise.all([
    aggregateAdminOrderReturnMetrics({
      createdAtRange,
    }),

    aggregateAdminOrderReturnReplacementMetrics({
      createdAtRange,
    }),
  ]);

  /*
    |--------------------------------------------------------------------------
    | Returns
    |--------------------------------------------------------------------------
    */

  const returnTotal = readFacetCount(returnMetrics.total);

  const returnStatusCounts = normalizeGroupedCounts(
    ORDER_RETURN_STATUS_VALUES,

    returnMetrics.byStatus,
  );

  const resolutionCounts = normalizeGroupedCounts(
    ORDER_RETURN_RESOLUTION_VALUES,

    returnMetrics.byResolution,
  );

  const refundRow = returnMetrics.refunds?.[0];

  const refundedCount = Number(refundRow?.count ?? 0);

  const refundedQuantity = Number(refundRow?.refundedQuantity ?? 0);

  const refundedAmount = Number(refundRow?.amount ?? 0);

  /*
    |--------------------------------------------------------------------------
    | Direct Operational Queue Counts
    |--------------------------------------------------------------------------
    */

  const awaitingRefund = readFacetCount(returnMetrics.awaitingRefund);

  const awaitingReplacementCreation = readFacetCount(
    returnMetrics.awaitingReplacementCreation,
  );

  /*
    |--------------------------------------------------------------------------
    | Replacements
    |--------------------------------------------------------------------------
    */

  const replacementTotal = readFacetCount(replacementMetrics.total);

  const replacementStatusCounts = normalizeGroupedCounts(
    ORDER_RETURN_REPLACEMENT_STATUS_VALUES,

    replacementMetrics.byStatus,
  );

  return {
    /*
      |--------------------------------------------------------------------------
      | Period Metadata
      |--------------------------------------------------------------------------
      */

    period: {
      from: from ?? null,

      to: to ?? null,

      timezone: "UTC",

      field: "createdAt",
    },

    returns: {
      total: returnTotal,

      byStatus: returnStatusCounts,

      byResolution: resolutionCounts,

      refunds: {
        processedCount: refundedCount,

        refundedQuantity,

        amount: refundedAmount,
      },
    },

    replacements: {
      total: replacementTotal,

      byStatus: replacementStatusCounts,
    },

    actionRequired: {
      returnsAwaitingDecision: returnStatusCounts.requested ?? 0,

      returnsAwaitingRefund: awaitingRefund,

      returnsAwaitingReplacementCreation: awaitingReplacementCreation,

      replacementsAwaitingProcessing: replacementStatusCounts.reserved ?? 0,

      replacementsProcessing: replacementStatusCounts.processing ?? 0,

      replacementsAwaitingDelivery: replacementStatusCounts.shipped ?? 0,
    },
  };
};
