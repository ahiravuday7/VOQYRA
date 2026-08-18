import env from "../../config/environment.js";

import logger from "../../config/logger.js";

import { findRecoverablePaymentReconciliationCandidates } from "./payment.repository.js";

import {
  PAYMENT_RECONCILIATION_ACTIONS,
  reconcilePaidPaymentTransaction,
} from "./payment-reconciliation.service.js";

/*
|--------------------------------------------------------------------------
| Reconciliation Worker Defaults
|--------------------------------------------------------------------------
*/

const DEFAULT_WORKER_INTERVAL_MS =
  env.PAYMENT_RECONCILIATION_WORKER_INTERVAL_MS;

const DEFAULT_RECONCILIATION_BATCH_SIZE =
  env.PAYMENT_RECONCILIATION_WORKER_BATCH_SIZE;

/*
|--------------------------------------------------------------------------
| Worker State
|--------------------------------------------------------------------------
*/

let workerStarted = false;

let workerStopping = false;

let workerTimer = null;

let activeCyclePromise = null;

let workerIntervalMs = DEFAULT_WORKER_INTERVAL_MS;

let workerBatchSize = DEFAULT_RECONCILIATION_BATCH_SIZE;

/*
|--------------------------------------------------------------------------
| Process Payment Reconciliation Batch
|--------------------------------------------------------------------------
|
| Important:
|
| We fetch one bounded snapshot of candidates.
|
| We do NOT repeatedly ask MongoDB for "the next candidate" during the
| same cycle.
|
| Why?
|
| A candidate may become:
|
| - already finalized
| - manual review
| - skipped
|
| after discovery.
|
| Taking one snapshot ensures the same candidate cannot repeatedly consume
| the whole batch.
|--------------------------------------------------------------------------
*/

export const processPaymentReconciliationBatch = async ({
  maxPayments = DEFAULT_RECONCILIATION_BATCH_SIZE,

  finder = findRecoverablePaymentReconciliationCandidates,

  processor = reconcilePaidPaymentTransaction,
} = {}) => {
  /*
  |--------------------------------------------------------------------------
  | Safe Bounded Batch Size
  |--------------------------------------------------------------------------
  */

  const safeMaxPayments = Math.min(
    Math.max(
      Number.isSafeInteger(maxPayments)
        ? maxPayments
        : DEFAULT_RECONCILIATION_BATCH_SIZE,

      1,
    ),

    100,
  );

  /*
  |--------------------------------------------------------------------------
  | Snapshot Candidates
  |--------------------------------------------------------------------------
  */

  const candidates = await finder({
    limit: safeMaxPayments,
  });

  /*
  |--------------------------------------------------------------------------
  | No Work
  |--------------------------------------------------------------------------
  */

  if (candidates.length === 0) {
    return {
      candidates: 0,

      recovered: 0,

      alreadyFinalized: 0,

      manualReview: 0,

      skipped: 0,

      failed: 0,

      idle: true,

      limitReached: false,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Batch Metrics
  |--------------------------------------------------------------------------
  */

  let recovered = 0;

  let alreadyFinalized = 0;

  let manualReview = 0;

  let skipped = 0;

  let failed = 0;

  /*
  |--------------------------------------------------------------------------
  | Process Sequentially
  |--------------------------------------------------------------------------
  |
  | Deliberately not Promise.all().
  |
  | Reconciliation can touch:
  |
  | - PaymentTransaction
  | - Order
  | - Product inventory
  | - Product inventory ledger
  |
  | Uncontrolled concurrency is unnecessary here.
  |--------------------------------------------------------------------------
  */

  for (const candidate of candidates) {
    try {
      const result = await processor(candidate._id);

      /*
      |--------------------------------------------------------------------------
      | Successfully Recovered
      |--------------------------------------------------------------------------
      */

      if (result?.action === PAYMENT_RECONCILIATION_ACTIONS.RECOVERED) {
        recovered += 1;

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Another Flow Already Finalized It
      |--------------------------------------------------------------------------
      |
      | Examples:
      |
      | - webhook completed first
      | - browser confirmation completed first
      | - another reconciliation worker completed first
      |--------------------------------------------------------------------------
      */

      if (result?.action === PAYMENT_RECONCILIATION_ACTIONS.ALREADY_FINALIZED) {
        alreadyFinalized += 1;

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Manual Review Required
      |--------------------------------------------------------------------------
      */

      if (result?.action === PAYMENT_RECONCILIATION_ACTIONS.MANUAL_REVIEW) {
        manualReview += 1;

        logger.warn(
          {
            paymentTransactionId: String(candidate._id),

            paymentNumber: candidate.paymentNumber ?? null,

            orderId: candidate.order ? String(candidate.order) : null,

            orderNumber: candidate.orderNumber ?? null,

            reconciliationReason: result.classification?.reason ?? null,
          },

          "Payment reconciliation requires manual review",
        );

        continue;
      }

      /*
      |--------------------------------------------------------------------------
      | Safe Skip
      |--------------------------------------------------------------------------
      |
      | Example:
      |
      | Candidate was paid when discovered but changed state before processing.
      |--------------------------------------------------------------------------
      */

      skipped += 1;
    } catch (error) {
      /*
      |--------------------------------------------------------------------------
      | Isolate One Payment Failure
      |--------------------------------------------------------------------------
      |
      | One corrupted/conflicting payment must not prevent recovery of every
      | other Payment in this batch.
      |--------------------------------------------------------------------------
      */

      failed += 1;

      logger.error(
        {
          error,

          paymentTransactionId: String(candidate._id),

          paymentNumber: candidate.paymentNumber ?? null,

          orderId: candidate.order ? String(candidate.order) : null,

          orderNumber: candidate.orderNumber ?? null,
        },

        "Payment reconciliation processing failed",
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Batch Result
  |--------------------------------------------------------------------------
  */

  return {
    candidates: candidates.length,

    recovered,

    alreadyFinalized,

    manualReview,

    skipped,

    failed,

    idle: false,

    /*
     * This does not guarantee that another candidate exists.
     *
     * It means only that this cycle consumed the configured maximum,
     * so another cycle may have additional work.
     */
    limitReached: candidates.length >= safeMaxPayments,
  };
};

/*
|--------------------------------------------------------------------------
| Run Payment Reconciliation Worker Cycle
|--------------------------------------------------------------------------
|
| Prevent overlapping reconciliation cycles inside this Node process.
|--------------------------------------------------------------------------
*/

export const runPaymentReconciliationWorkerCycle = ({
  maxPayments = workerBatchSize,

  finder = findRecoverablePaymentReconciliationCandidates,

  processor = reconcilePaidPaymentTransaction,
} = {}) => {
  /*
  |--------------------------------------------------------------------------
  | Existing Cycle Still Running
  |--------------------------------------------------------------------------
  */

  if (activeCyclePromise) {
    return activeCyclePromise;
  }

  activeCyclePromise = processPaymentReconciliationBatch({
    maxPayments,

    finder,

    processor,
  })
    .then((result) => {
      logger.debug(
        {
          candidates: result.candidates,

          recovered: result.recovered,

          alreadyFinalized: result.alreadyFinalized,

          manualReview: result.manualReview,

          skipped: result.skipped,

          failed: result.failed,

          idle: result.idle,

          limitReached: result.limitReached,
        },

        "Payment reconciliation worker cycle completed",
      );

      return result;
    })
    .catch((error) => {
      logger.error(
        {
          error,
        },

        "Payment reconciliation worker cycle failed",
      );

      throw error;
    })
    .finally(() => {
      activeCyclePromise = null;
    });

  return activeCyclePromise;
};

/*
|--------------------------------------------------------------------------
| Schedule Next Reconciliation Cycle
|--------------------------------------------------------------------------
|
| setTimeout is deliberately used instead of setInterval.
|
| cycle finishes
|      ↓
| wait interval
|      ↓
| next cycle
|
| A slow MongoDB transaction therefore cannot cause scheduled cycles
| to pile up.
|--------------------------------------------------------------------------
*/

const scheduleNextPaymentReconciliationWorkerCycle = () => {
  if (!workerStarted || workerStopping) {
    return;
  }

  workerTimer = setTimeout(
    async () => {
      workerTimer = null;

      try {
        await runPaymentReconciliationWorkerCycle();
      } catch {
        /*
         * Error already logged by run...().
         *
         * Reconciliation is a recovery worker, so one failed cycle
         * must not permanently stop future recovery attempts.
         */
      } finally {
        scheduleNextPaymentReconciliationWorkerCycle();
      }
    },

    workerIntervalMs,
  );

  /*
   * Do not keep Node alive solely because of this timer.
   */
  workerTimer.unref?.();
};

/*
|--------------------------------------------------------------------------
| Start Payment Reconciliation Worker
|--------------------------------------------------------------------------
*/

export const startPaymentReconciliationWorker = ({
  intervalMs = DEFAULT_WORKER_INTERVAL_MS,

  batchSize = DEFAULT_RECONCILIATION_BATCH_SIZE,
} = {}) => {
  /*
  |--------------------------------------------------------------------------
  | Idempotent Start
  |--------------------------------------------------------------------------
  */

  if (workerStarted) {
    return {
      started: false,

      reason: "already-started",
    };
  }

  workerIntervalMs = intervalMs;

  workerBatchSize = batchSize;

  workerStopping = false;

  workerStarted = true;

  logger.info(
    {
      intervalMs: workerIntervalMs,

      batchSize: workerBatchSize,
    },

    "Payment reconciliation worker started",
  );

  /*
  |--------------------------------------------------------------------------
  | Immediate Startup Recovery
  |--------------------------------------------------------------------------
  |
  | If the API crashed after a Payment became paid but before the Order
  | finalized, we should not wait 30 seconds after restart before trying
  | recovery.
  |--------------------------------------------------------------------------
  */

  void runPaymentReconciliationWorkerCycle()
    .catch(() => {
      /*
       * Error already logged.
       */
    })
    .finally(() => {
      scheduleNextPaymentReconciliationWorkerCycle();
    });

  return {
    started: true,
  };
};

/*
|--------------------------------------------------------------------------
| Stop Payment Reconciliation Worker
|--------------------------------------------------------------------------
*/

export const stopPaymentReconciliationWorker = async () => {
  /*
    |--------------------------------------------------------------------------
    | Already Stopped
    |--------------------------------------------------------------------------
    */

  if (!workerStarted) {
    return {
      stopped: false,

      reason: "not-started",
    };
  }

  workerStopping = true;

  workerStarted = false;

  /*
    |--------------------------------------------------------------------------
    | Cancel Future Scheduled Cycle
    |--------------------------------------------------------------------------
    */

  if (workerTimer) {
    clearTimeout(workerTimer);

    workerTimer = null;
  }

  /*
    |--------------------------------------------------------------------------
    | Let Current Reconciliation Transaction Finish
    |--------------------------------------------------------------------------
    |
    | We do not want SIGTERM to interrupt inventory/payment recovery halfway
    | through the current transaction.
    |--------------------------------------------------------------------------
    */

  if (activeCyclePromise) {
    try {
      await activeCyclePromise;
    } catch {
      /*
       * Error already logged.
       */
    }
  }

  workerStopping = false;

  logger.info("Payment reconciliation worker stopped");

  return {
    stopped: true,
  };
};
