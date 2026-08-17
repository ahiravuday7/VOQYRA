import logger from "../../config/logger.js";

import { processNextPaymentWebhookEvent } from "./payment-webhook-processor.service.js";

/*
|--------------------------------------------------------------------------
| Worker Configuration
|--------------------------------------------------------------------------
*/

const DEFAULT_WORKER_INTERVAL_MS = 5_000;

const DEFAULT_WORKER_BATCH_SIZE = 25;

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
| Worker Runtime Telemetry
|--------------------------------------------------------------------------
*/

let workerStartedAt = null;

let workerStoppedAt = null;

let lastCycleStartedAt = null;

let lastCycleFinishedAt = null;

let lastCycleDurationMs = null;

let lastCycleResult = null;

let lastCycleError = null;

let totalCycles = 0;

let successfulCycles = 0;

let failedCycles = 0;

let skippedBusyCycles = 0;

/*
|--------------------------------------------------------------------------
| Process Webhook Batch
|--------------------------------------------------------------------------
|
| A single cycle processes at most maxEvents.
|
| This protects the Node event loop from an unbounded queue.
|--------------------------------------------------------------------------
*/

export const processPaymentWebhookBatch = async ({
  maxEvents = DEFAULT_WORKER_BATCH_SIZE,

  processor = processNextPaymentWebhookEvent,
} = {}) => {
  if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) {
    throw new TypeError(
      "Payment webhook worker maxEvents must be a positive integer",
    );
  }

  let claimed = 0;

  let processed = 0;

  let failed = 0;

  let deadLettered = 0;

  /*
    |--------------------------------------------------------------------------
    | Bounded Drain
    |--------------------------------------------------------------------------
    */

  for (let index = 0; index < maxEvents; index += 1) {
    const result = await processor();

    /*
      |--------------------------------------------------------------------------
      | Queue Empty
      |--------------------------------------------------------------------------
      */

    if (result.action === "idle") {
      return {
        claimed,

        processed,

        failed,

        deadLettered,

        idle: true,

        limitReached: false,
      };
    }

    claimed += 1;

    if (result.action === "processed") {
      processed += 1;
    }

    if (result.action === "failed") {
      failed += 1;
    }

    if (result.action === "dead-lettered") {
      /*
       * Dead-lettered is still a processing failure,
       * but we track it separately as well.
       */
      failed += 1;

      deadLettered += 1;
    }
  }

  return {
    claimed,

    processed,

    failed,

    deadLettered,

    idle: false,

    limitReached: true,
  };
};

/*
|--------------------------------------------------------------------------
| Run Single Worker Cycle
|--------------------------------------------------------------------------
|
| Only one cycle may execute inside this Node process at a time.
|--------------------------------------------------------------------------
*/

export const runPaymentWebhookWorkerCycle = ({
  maxEvents = workerBatchSize,

  processor = processNextPaymentWebhookEvent,
} = {}) => {
  /*
    |--------------------------------------------------------------------------
    | Prevent Overlap
    |--------------------------------------------------------------------------
    */

  if (activeCyclePromise) {
    skippedBusyCycles += 1;

    return Promise.resolve({
      action: "skip",

      reason: "busy",
    });
  }

  /*
    |--------------------------------------------------------------------------
    | Cycle Started
    |--------------------------------------------------------------------------
    */

  const cycleStartedAt = new Date();

  lastCycleStartedAt = cycleStartedAt;

  lastCycleError = null;

  activeCyclePromise = (async () => {
    try {
      const batch = await processPaymentWebhookBatch({
        maxEvents,

        processor,
      });

      /*
          |--------------------------------------------------------------------------
          | Success Metrics
          |--------------------------------------------------------------------------
          */

      successfulCycles += 1;

      lastCycleResult = {
        claimed: batch.claimed,

        processed: batch.processed,

        failed: batch.failed,

        deadLettered: batch.deadLettered,

        idle: batch.idle,

        limitReached: batch.limitReached,
      };

      return {
        action: "run",

        ...batch,
      };
    } catch (error) {
      /*
          |--------------------------------------------------------------------------
          | Cycle Failure
          |--------------------------------------------------------------------------
          */

      failedCycles += 1;

      lastCycleResult = null;

      lastCycleError = {
        code: error?.code ?? null,

        message: error?.message ?? "Payment webhook worker cycle failed",
      };

      throw error;
    } finally {
      /*
          |--------------------------------------------------------------------------
          | Cycle Finished
          |--------------------------------------------------------------------------
          */

      const cycleFinishedAt = new Date();

      lastCycleFinishedAt = cycleFinishedAt;

      lastCycleDurationMs = Math.max(
        cycleFinishedAt.getTime() - cycleStartedAt.getTime(),

        0,
      );

      totalCycles += 1;
    }
  })();

  return activeCyclePromise.finally(() => {
    activeCyclePromise = null;
  });
};

/*
|--------------------------------------------------------------------------
| Schedule Next Cycle
|--------------------------------------------------------------------------
|
| setTimeout is deliberately used instead of setInterval.
|
| That means:
|
| cycle finishes
|     ↓
| wait interval
|     ↓
| next cycle
|
| Slow provider/API/database work therefore cannot create overlapping
| scheduled executions.
|--------------------------------------------------------------------------
*/

const scheduleNextWorkerCycle = () => {
  if (!workerStarted || workerStopping) {
    return;
  }

  workerTimer = setTimeout(
    async () => {
      workerTimer = null;

      try {
        const result = await runPaymentWebhookWorkerCycle();

        if (
          result.action === "run" &&
          (result.claimed > 0 || result.failed > 0)
        ) {
          logger.info(
            {
              claimed: result.claimed,

              processed: result.processed,

              failed: result.failed,

              deadLettered: result.deadLettered,

              limitReached: result.limitReached,
            },

            "Payment webhook worker cycle completed",
          );
        }
      } catch (error) {
        /*
         * A worker-cycle failure must not crash
         * the HTTP API process.
         */
        logger.error(
          {
            err: error,
          },

          "Payment webhook worker cycle failed",
        );
      } finally {
        scheduleNextWorkerCycle();
      }
    },

    workerIntervalMs,
  );

  /*
   * The timer itself should not keep Node alive
   * during application shutdown.
   */
  workerTimer.unref?.();
};

/*
|--------------------------------------------------------------------------
| Start Payment Webhook Worker
|--------------------------------------------------------------------------
*/

export const startPaymentWebhookWorker = ({
  intervalMs = DEFAULT_WORKER_INTERVAL_MS,

  batchSize = DEFAULT_WORKER_BATCH_SIZE,
} = {}) => {
  if (workerStarted) {
    return {
      action: "reuse",
    };
  }

  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new TypeError(
      "Payment webhook worker interval must be at least 1000ms",
    );
  }

  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new TypeError(
      "Payment webhook worker batch size must be a positive integer",
    );
  }

  workerIntervalMs = intervalMs;

  workerBatchSize = batchSize;

  workerStopping = false;

  workerStarted = true;

  workerStartedAt = new Date();

  workerStoppedAt = null;

  logger.info(
    {
      intervalMs: workerIntervalMs,

      batchSize: workerBatchSize,
    },

    "Payment webhook worker started",
  );

  /*
    |--------------------------------------------------------------------------
    | Run Immediately On Startup
    |--------------------------------------------------------------------------
    |
    | This recovers webhook events that may have accumulated while the API
    | was offline.
    |--------------------------------------------------------------------------
    */

  void runPaymentWebhookWorkerCycle()
    .catch((error) => {
      logger.error(
        {
          err: error,
        },

        "Initial Payment webhook worker cycle failed",
      );
    })
    .finally(() => {
      scheduleNextWorkerCycle();
    });

  return {
    action: "start",
  };
};

/*
|--------------------------------------------------------------------------
| Stop Payment Webhook Worker
|--------------------------------------------------------------------------
*/

export const stopPaymentWebhookWorker = async () => {
  if (!workerStarted && !activeCyclePromise) {
    return {
      action: "reuse",
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
    | Finish Active Cycle
    |--------------------------------------------------------------------------
    */

  if (activeCyclePromise) {
    try {
      await activeCyclePromise;
    } catch (error) {
      logger.error(
        {
          err: error,
        },

        "Payment webhook worker stopped after active cycle failure",
      );
    }
  }

  workerStopping = false;

  workerStoppedAt = new Date();

  logger.info("Payment webhook worker stopped");

  return {
    action: "stop",
  };
};

/*
|--------------------------------------------------------------------------
| Get Payment Webhook Worker Health
|--------------------------------------------------------------------------
|
| Read-only runtime snapshot.
|
| Does not start, stop, or trigger processing.
|--------------------------------------------------------------------------
*/

export const getPaymentWebhookWorkerHealth = () => {
  /*
    |--------------------------------------------------------------------------
    | Runtime Status
    |--------------------------------------------------------------------------
    */

  let status = "stopped";

  if (workerStopping) {
    status = "stopping";
  } else if (activeCyclePromise) {
    status = "busy";
  } else if (workerStarted) {
    status = "idle";
  }

  /*
    |--------------------------------------------------------------------------
    | Last Cycle
    |--------------------------------------------------------------------------
    */

  const lastCycle = {
    startedAt: lastCycleStartedAt,

    finishedAt: lastCycleFinishedAt,

    durationMs: lastCycleDurationMs,

    result: lastCycleResult
      ? {
          ...lastCycleResult,
        }
      : null,

    error: lastCycleError
      ? {
          ...lastCycleError,
        }
      : null,
  };

  return {
    status,

    started: workerStarted,

    stopping: workerStopping,

    busy: Boolean(activeCyclePromise),

    configuration: {
      intervalMs: workerIntervalMs,

      batchSize: workerBatchSize,
    },

    lifecycle: {
      startedAt: workerStartedAt,

      stoppedAt: workerStoppedAt,
    },

    cycles: {
      total: totalCycles,

      successful: successfulCycles,

      failed: failedCycles,

      skippedBusy: skippedBusyCycles,
    },

    lastCycle,
  };
};
