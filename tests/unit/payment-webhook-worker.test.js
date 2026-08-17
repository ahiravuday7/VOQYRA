import { describe, expect, it } from "vitest";

import {
  processPaymentWebhookBatch,
  runPaymentWebhookWorkerCycle,
  getPaymentWebhookWorkerHealth,
} from "../../src/modules/payments/payment-webhook-worker.service.js";

/*
|--------------------------------------------------------------------------
| Part 195 — Payment Webhook Worker
|--------------------------------------------------------------------------
*/

describe("Payment webhook worker", () => {
  /*
    |--------------------------------------------------------------------------
    | 1. Stops When Queue Is Empty
    |--------------------------------------------------------------------------
    */

  it("stops the batch immediately when the processor reports idle", async () => {
    let calls = 0;

    const processor = async () => {
      calls += 1;

      return {
        action: "idle",
      };
    };

    const result = await processPaymentWebhookBatch({
      maxEvents: 25,

      processor,
    });

    expect(calls).toBe(1);

    expect(result).toEqual({
      claimed: 0,

      processed: 0,

      failed: 0,

      deadLettered: 0,

      idle: true,

      limitReached: false,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | 2. Drains Multiple Events
    |--------------------------------------------------------------------------
    */

  it("processes multiple webhook events until the queue becomes idle", async () => {
    const results = [
      {
        action: "processed",
      },

      {
        action: "processed",
      },

      {
        action: "failed",
      },

      {
        action: "idle",
      },
    ];

    let index = 0;

    const processor = async () => {
      const result = results[index];

      index += 1;

      return result;
    };

    const result = await processPaymentWebhookBatch({
      maxEvents: 25,

      processor,
    });

    expect(result.claimed).toBe(3);

    expect(result.processed).toBe(2);

    expect(result.failed).toBe(1);

    expect(result.idle).toBe(true);

    expect(result.limitReached).toBe(false);
  });

  /*
    |--------------------------------------------------------------------------
    | 3. Batch Limit
    |--------------------------------------------------------------------------
    */

  it("never processes more webhook events than the configured batch limit", async () => {
    let calls = 0;

    const processor = async () => {
      calls += 1;

      return {
        action: "processed",
      };
    };

    const result = await processPaymentWebhookBatch({
      maxEvents: 5,

      processor,
    });

    expect(calls).toBe(5);

    expect(result.claimed).toBe(5);

    expect(result.processed).toBe(5);

    expect(result.limitReached).toBe(true);
  });

  /*
    |--------------------------------------------------------------------------
    | 4. No Overlapping Worker Cycles
    |--------------------------------------------------------------------------
    */

  it("skips a second worker cycle while another cycle is still running", async () => {
    let releaseFirstProcessor;

    const processorPromise = new Promise((resolve) => {
      releaseFirstProcessor = resolve;
    });

    const slowProcessor = async () => {
      await processorPromise;

      return {
        action: "idle",
      };
    };

    /*
        |--------------------------------------------------------------------------
        | Start Slow Cycle
        |--------------------------------------------------------------------------
        */

    const firstCyclePromise = runPaymentWebhookWorkerCycle({
      maxEvents: 1,

      processor: slowProcessor,
    });

    /*
        |--------------------------------------------------------------------------
        | Second Cycle Must Not Overlap
        |--------------------------------------------------------------------------
        */

    const secondResult = await runPaymentWebhookWorkerCycle({
      maxEvents: 1,

      processor: slowProcessor,
    });

    expect(secondResult).toEqual({
      action: "skip",

      reason: "busy",
    });

    /*
        |--------------------------------------------------------------------------
        | Finish First
        |--------------------------------------------------------------------------
        */

    releaseFirstProcessor();

    const firstResult = await firstCyclePromise;

    expect(firstResult.action).toBe("run");
  });

  /*
|--------------------------------------------------------------------------
| Dead-Letter Metrics
|--------------------------------------------------------------------------
*/

  it("counts exhausted webhook events as failed and dead-lettered", async () => {
    const results = [
      {
        action: "dead-lettered",
      },

      {
        action: "idle",
      },
    ];

    let index = 0;

    const processor = async () => {
      const result = results[index];

      index += 1;

      return result;
    };

    const result = await processPaymentWebhookBatch({
      maxEvents: 10,

      processor,
    });

    expect(result.claimed).toBe(1);

    expect(result.processed).toBe(0);

    expect(result.failed).toBe(1);

    expect(result.deadLettered).toBe(1);

    expect(result.idle).toBe(true);
  });

  /*
|--------------------------------------------------------------------------
| Worker Health Telemetry
|--------------------------------------------------------------------------
*/

  it("records runtime health after a successful worker cycle", async () => {
    const before = getPaymentWebhookWorkerHealth();

    const processor = async () => {
      return {
        action: "idle",
      };
    };

    const result = await runPaymentWebhookWorkerCycle({
      maxEvents: 5,

      processor,
    });

    expect(result.action).toBe("run");

    const health = getPaymentWebhookWorkerHealth();

    expect(health.cycles.total).toBeGreaterThan(before.cycles.total);

    expect(health.cycles.successful).toBeGreaterThan(before.cycles.successful);

    expect(health.lastCycle.startedAt).toBeInstanceOf(Date);

    expect(health.lastCycle.finishedAt).toBeInstanceOf(Date);

    expect(health.lastCycle.durationMs).toBeGreaterThanOrEqual(0);

    expect(health.lastCycle.error).toBeNull();

    expect(health.lastCycle.result).toMatchObject({
      claimed: 0,

      processed: 0,

      failed: 0,

      deadLettered: 0,

      idle: true,
    });
  });

  /*
|--------------------------------------------------------------------------
| Failed Cycle Health
|--------------------------------------------------------------------------
*/

  it("records a worker cycle failure without losing runtime health", async () => {
    const processor = async () => {
      const error = new Error("Test worker failure");

      error.code = "TEST_WORKER_FAILURE";

      throw error;
    };

    await expect(
      runPaymentWebhookWorkerCycle({
        maxEvents: 1,

        processor,
      }),
    ).rejects.toThrow("Test worker failure");

    const health = getPaymentWebhookWorkerHealth();

    expect(health.cycles.failed).toBeGreaterThanOrEqual(1);

    expect(health.lastCycle.result).toBeNull();

    expect(health.lastCycle.error).toEqual({
      code: "TEST_WORKER_FAILURE",

      message: "Test worker failure",
    });
  });
});
