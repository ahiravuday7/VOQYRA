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
  }

  return {
    claimed,

    processed,

    failed,

    idle: false,

    limitReached: true,
  };
};

/*
|--------------------------------------------------------------------------
| Run Single Worker Cycle
|--------------------------------------------------------------------------
|
| Prevent overlapping cycles.
|--------------------------------------------------------------------------
*/

export const runPaymentWebhookWorkerCycle = ({
  maxEvents = workerBatchSize,

  processor = processNextPaymentWebhookEvent,
} = {}) => {
  /*
    |--------------------------------------------------------------------------
    | Existing Cycle Still Running
    |--------------------------------------------------------------------------
    */

  if (activeCyclePromise) {
    return Promise.resolve({
      action: "skip",

      reason: "busy",
    });
  }

  activeCyclePromise = (async () => {
    const batch = await processPaymentWebhookBatch({
      maxEvents,

      processor,
    });

    return {
      action: "run",

      ...batch,
    };
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

  logger.info("Payment webhook worker stopped");

  return {
    action: "stop",
  };
};
