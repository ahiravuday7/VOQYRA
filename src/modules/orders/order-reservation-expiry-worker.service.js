import env from "../../config/environment.js";

import logger from "../../config/logger.js";

import { expireOnlineOrderInventoryReservation } from "./order.service.js";

import { findExpiredOnlineOrderReservations } from "./order.repository.js";

/*
|--------------------------------------------------------------------------
| Worker Defaults
|--------------------------------------------------------------------------
*/

const DEFAULT_WORKER_INTERVAL_MS =
  env.ONLINE_ORDER_RESERVATION_WORKER_INTERVAL_MS;

const DEFAULT_WORKER_BATCH_SIZE =
  env.ONLINE_ORDER_RESERVATION_WORKER_BATCH_SIZE;

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

let workerBatchSize = DEFAULT_WORKER_BATCH_SIZE;

/*
|--------------------------------------------------------------------------
| Process Expired Reservation Batch
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| We load the candidate IDs once.
|
| We do NOT repeatedly ask for "the next candidate".
|
| Why?
|
| Example:
|
| Order A = expired
| Payment = authorized
|
| Part 202 correctly skips Order A.
|
| If we immediately queried "next expired Order" again,
| Order A could still be first and the batch could repeatedly
| process the same Order.
|
| Fetching one bounded candidate list prevents that.
|--------------------------------------------------------------------------
*/

export const processExpiredOrderReservationBatch = async ({
  maxOrders = DEFAULT_WORKER_BATCH_SIZE,

  now = new Date(),

  finder = findExpiredOnlineOrderReservations,

  processor = expireOnlineOrderInventoryReservation,
} = {}) => {
  const safeMaxOrders = Math.min(
    Math.max(
      Number.isSafeInteger(maxOrders) ? maxOrders : DEFAULT_WORKER_BATCH_SIZE,

      1,
    ),

    100,
  );

  /*
    |--------------------------------------------------------------------------
    | Snapshot Candidate Set
    |--------------------------------------------------------------------------
    */

  const candidates = await finder({
    now,

    limit: safeMaxOrders,
  });

  /*
    |--------------------------------------------------------------------------
    | No Work
    |--------------------------------------------------------------------------
    */

  if (candidates.length === 0) {
    return {
      candidates: 0,

      expired: 0,

      skipped: 0,

      failed: 0,

      idle: true,

      limitReached: false,
    };
  }

  /*
    |--------------------------------------------------------------------------
    | Metrics
    |--------------------------------------------------------------------------
    */

  let expired = 0;

  let skipped = 0;

  let failed = 0;

  /*
    |--------------------------------------------------------------------------
    | Process Sequentially
    |--------------------------------------------------------------------------
    |
    | Deliberately sequential.
    |
    | Expiry touches:
    |
    | - Order
    | - Product inventory
    | - Inventory Ledger
    | - PaymentTransaction
    |
    | We do not need uncontrolled Promise.all concurrency here.
    |--------------------------------------------------------------------------
    */

  for (const candidate of candidates) {
    try {
      const result = await processor(
        candidate._id,

        {
          now,
        },
      );

      if (result?.action === "expire") {
        expired += 1;

        continue;
      }

      /*
       * Examples:
       *
       * order-not-expirable
       * payment-state-blocks-expiry
       *
       * Both are safe skips.
       */
      skipped += 1;
    } catch (error) {
      failed += 1;

      /*
        |--------------------------------------------------------------------------
        | Isolate One Order Failure
        |--------------------------------------------------------------------------
        |
        | A corrupted reservation must not stop expiry processing for every
        | other Order in the batch.
        |--------------------------------------------------------------------------
        */

      logger.error(
        {
          error,

          orderId: String(candidate._id),

          orderNumber: candidate.orderNumber ?? null,
        },

        "Expired online Order reservation processing failed",
      );
    }
  }

  return {
    candidates: candidates.length,

    expired,

    skipped,

    failed,

    idle: false,

    /*
     * This does not guarantee more candidates exist.
     *
     * It only means we consumed the configured maximum
     * and another cycle may have more work.
     */
    limitReached: candidates.length >= safeMaxOrders,
  };
};

/*
|--------------------------------------------------------------------------
| Run Worker Cycle
|--------------------------------------------------------------------------
|
| Prevent overlapping cycles inside this Node process.
|--------------------------------------------------------------------------
*/

export const runOrderReservationExpiryWorkerCycle = ({
  maxOrders = workerBatchSize,

  now = new Date(),

  processor = expireOnlineOrderInventoryReservation,
} = {}) => {
  /*
    |--------------------------------------------------------------------------
    | Existing Cycle Running
    |--------------------------------------------------------------------------
    */

  if (activeCyclePromise) {
    return activeCyclePromise;
  }

  activeCyclePromise = processExpiredOrderReservationBatch({
    maxOrders,

    now,

    processor,
  })
    .then((result) => {
      logger.debug(
        {
          candidates: result.candidates,

          expired: result.expired,

          skipped: result.skipped,

          failed: result.failed,

          idle: result.idle,

          limitReached: result.limitReached,
        },

        "Online Order reservation expiry worker cycle completed",
      );

      return result;
    })
    .catch((error) => {
      logger.error(
        {
          error,
        },

        "Online Order reservation expiry worker cycle failed",
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
| Schedule Next Cycle
|--------------------------------------------------------------------------
*/

const scheduleNextOrderReservationExpiryWorkerCycle = () => {
  /*
   * Worker may have been stopped while a cycle was running.
   */
  if (!workerStarted || workerStopping) {
    return;
  }

  workerTimer = setTimeout(
    async () => {
      try {
        await runOrderReservationExpiryWorkerCycle();
      } catch {
        /*
         * Error already logged inside run...().
         *
         * We intentionally continue scheduling future cycles.
         */
      } finally {
        scheduleNextOrderReservationExpiryWorkerCycle();
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
| Start Worker
|--------------------------------------------------------------------------
*/

export const startOrderReservationExpiryWorker = ({
  intervalMs = DEFAULT_WORKER_INTERVAL_MS,

  batchSize = DEFAULT_WORKER_BATCH_SIZE,
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

    "Online Order reservation expiry worker started",
  );

  /*
    |--------------------------------------------------------------------------
    | Startup Cycle
    |--------------------------------------------------------------------------
    |
    | Process existing expired reservations immediately after startup.
    |--------------------------------------------------------------------------
    */

  void runOrderReservationExpiryWorkerCycle()
    .catch(() => {
      /*
       * Already logged.
       */
    })
    .finally(() => {
      scheduleNextOrderReservationExpiryWorkerCycle();
    });

  return {
    started: true,
  };
};

/*
|--------------------------------------------------------------------------
| Stop Worker
|--------------------------------------------------------------------------
*/

export const stopOrderReservationExpiryWorker = async () => {
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
    | Cancel Future Cycle
    |--------------------------------------------------------------------------
    */

  if (workerTimer) {
    clearTimeout(workerTimer);

    workerTimer = null;
  }

  /*
    |--------------------------------------------------------------------------
    | Let Active Transaction Finish
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

  logger.info("Online Order reservation expiry worker stopped");

  return {
    stopped: true,
  };
};
