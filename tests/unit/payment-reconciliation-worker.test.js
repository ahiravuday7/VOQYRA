import { afterEach, describe, expect, it, vi } from "vitest";

import {
  processPaymentReconciliationBatch,
  runPaymentReconciliationWorkerCycle,
  startPaymentReconciliationWorker,
  stopPaymentReconciliationWorker,
} from "../../src/modules/payments/payment-reconciliation-worker.service.js";

import { PAYMENT_RECONCILIATION_ACTIONS } from "../../src/modules/payments/payment-reconciliation.service.js";

afterEach(async () => {
  /*
   * Ensure one lifecycle test cannot leave the singleton worker running
   * for the next test.
   */
  await stopPaymentReconciliationWorker();
});

/*
|--------------------------------------------------------------------------
| Part 206 — Payment Reconciliation Batch Processor
|--------------------------------------------------------------------------
*/

describe("Payment reconciliation worker", () => {
  /*
  |--------------------------------------------------------------------------
  | 1. Empty Queue
  |--------------------------------------------------------------------------
  */

  it("returns idle when no reconciliation candidates are available", async () => {
    const finder = vi.fn().mockResolvedValue([]);

    const processor = vi.fn();

    const result = await processPaymentReconciliationBatch({
      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledTimes(1);

    expect(finder).toHaveBeenCalledWith({
      limit: 25,
    });

    expect(processor).not.toHaveBeenCalled();

    expect(result).toEqual({
      candidates: 0,

      recovered: 0,

      alreadyFinalized: 0,

      manualReview: 0,

      skipped: 0,

      failed: 0,

      idle: true,

      limitReached: false,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 2. Recover Candidates
  |--------------------------------------------------------------------------
  */

  it("processes every reconciliation candidate exactly once", async () => {
    const candidates = [
      {
        _id: "66aa00000000000000000101",

        paymentNumber: "PAY-RECON-001",

        order: "66aa00000000000000000201",

        orderNumber: "ORD-RECON-001",
      },

      {
        _id: "66aa00000000000000000102",

        paymentNumber: "PAY-RECON-002",

        order: "66aa00000000000000000202",

        orderNumber: "ORD-RECON-002",
      },
    ];

    const finder = vi.fn().mockResolvedValue(candidates);

    const processor = vi.fn().mockResolvedValue({
      action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,
    });

    const result = await processPaymentReconciliationBatch({
      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledTimes(1);

    expect(processor).toHaveBeenCalledTimes(2);

    expect(processor).toHaveBeenNthCalledWith(1, candidates[0]._id);

    expect(processor).toHaveBeenNthCalledWith(2, candidates[1]._id);

    expect(result).toEqual({
      candidates: 2,

      recovered: 2,

      alreadyFinalized: 0,

      manualReview: 0,

      skipped: 0,

      failed: 0,

      idle: false,

      limitReached: false,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 3. Count Every Outcome Independently
  |--------------------------------------------------------------------------
  */

  it("counts recovered, already-finalized, manual-review and skipped outcomes independently", async () => {
    const candidates = [
      {
        _id: "payment-1",
      },

      {
        _id: "payment-2",
      },

      {
        _id: "payment-3",

        paymentNumber: "PAY-MANUAL-001",

        order: "order-3",

        orderNumber: "ORD-MANUAL-001",
      },

      {
        _id: "payment-4",
      },
    ];

    const finder = vi.fn().mockResolvedValue(candidates);

    const processor = vi
      .fn()
      .mockResolvedValueOnce({
        action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,
      })
      .mockResolvedValueOnce({
        action: PAYMENT_RECONCILIATION_ACTIONS.ALREADY_FINALIZED,
      })
      .mockResolvedValueOnce({
        action: PAYMENT_RECONCILIATION_ACTIONS.MANUAL_REVIEW,

        classification: {
          reason: "order-state-conflict",
        },
      })
      .mockResolvedValueOnce({
        action: PAYMENT_RECONCILIATION_ACTIONS.SKIPPED,
      });

    const result = await processPaymentReconciliationBatch({
      finder,

      processor,
    });

    expect(processor).toHaveBeenCalledTimes(4);

    expect(result.candidates).toBe(4);

    expect(result.recovered).toBe(1);

    expect(result.alreadyFinalized).toBe(1);

    expect(result.manualReview).toBe(1);

    expect(result.skipped).toBe(1);

    expect(result.failed).toBe(0);

    expect(result.idle).toBe(false);

    expect(result.limitReached).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | 4. One Failure Must Not Stop The Batch
  |--------------------------------------------------------------------------
  */

  it("continues reconciling later Payments when one candidate fails", async () => {
    const candidates = [
      {
        _id: "66aa00000000000000000301",

        paymentNumber: "PAY-FAIL-001",

        order: "66aa00000000000000000401",

        orderNumber: "ORD-FAIL-001",
      },

      {
        _id: "66aa00000000000000000302",

        paymentNumber: "PAY-OK-001",

        order: "66aa00000000000000000402",

        orderNumber: "ORD-OK-001",
      },
    ];

    const finder = vi.fn().mockResolvedValue(candidates);

    const processor = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary transaction failure"))
      .mockResolvedValueOnce({
        action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,
      });

    const result = await processPaymentReconciliationBatch({
      finder,

      processor,
    });

    expect(processor).toHaveBeenCalledTimes(2);

    expect(result.candidates).toBe(2);

    expect(result.recovered).toBe(1);

    expect(result.failed).toBe(1);

    expect(result.alreadyFinalized).toBe(0);

    expect(result.manualReview).toBe(0);

    expect(result.skipped).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | 5. Batch Limit
  |--------------------------------------------------------------------------
  */

  it("reports when the configured reconciliation batch limit is reached", async () => {
    const candidates = [
      {
        _id: "payment-limit-1",
      },

      {
        _id: "payment-limit-2",
      },
    ];

    const finder = vi.fn().mockResolvedValue(candidates);

    const processor = vi.fn().mockResolvedValue({
      action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,
    });

    const result = await processPaymentReconciliationBatch({
      maxPayments: 2,

      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledWith({
      limit: 2,
    });

    expect(result.candidates).toBe(2);

    expect(result.recovered).toBe(2);

    expect(result.limitReached).toBe(true);
  });

  /*
  |--------------------------------------------------------------------------
  | 6. Configured Limit Is Bounded
  |--------------------------------------------------------------------------
  */

  it("caps the reconciliation batch size at 100", async () => {
    const finder = vi.fn().mockResolvedValue([]);

    const processor = vi.fn();

    await processPaymentReconciliationBatch({
      maxPayments: 1000,

      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledWith({
      limit: 100,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 7. Invalid Limit Falls Back To Default
  |--------------------------------------------------------------------------
  */

  it("uses the default batch size when maxPayments is invalid", async () => {
    const finder = vi.fn().mockResolvedValue([]);

    await processPaymentReconciliationBatch({
      maxPayments: "invalid",

      finder,
    });

    expect(finder).toHaveBeenCalledWith({
      limit: 25,
    });
  });

  /*
|--------------------------------------------------------------------------
| 8. No Overlapping Reconciliation Cycles
|--------------------------------------------------------------------------
*/

  it("shares the active reconciliation cycle instead of starting an overlapping cycle", async () => {
    let releaseProcessor;

    const processorGate = new Promise((resolve) => {
      releaseProcessor = resolve;
    });

    const candidate = {
      _id: "66aa00000000000000000901",

      paymentNumber: "PAY-OVERLAP-001",

      order: "66aa00000000000000000902",

      orderNumber: "ORD-OVERLAP-001",
    };

    const finder = vi.fn().mockResolvedValue([candidate]);

    const processor = vi.fn().mockImplementation(async () => {
      await processorGate;

      return {
        action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,
      };
    });

    /*
  |--------------------------------------------------------------------------
  | First Cycle Starts And Remains Active
  |--------------------------------------------------------------------------
  */

    const firstCyclePromise = runPaymentReconciliationWorkerCycle({
      maxPayments: 1,

      finder,

      processor,
    });

    /*
  |--------------------------------------------------------------------------
  | Second Cycle Arrives While First Is Still Active
  |--------------------------------------------------------------------------
  */

    const secondCyclePromise = runPaymentReconciliationWorkerCycle({
      maxPayments: 1,

      finder,

      processor,
    });

    /*
     * The reconciliation worker deliberately returns the same in-flight
     * Promise instead of launching another database batch.
     */
    expect(secondCyclePromise).toBe(firstCyclePromise);

    /*
     * Allow the first cycle to actually reach the processor.
     */
    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledTimes(1);
    });

    expect(finder).toHaveBeenCalledTimes(1);

    /*
  |--------------------------------------------------------------------------
  | Release Active Cycle
  |--------------------------------------------------------------------------
  */

    releaseProcessor();

    const [firstResult, secondResult] = await Promise.all([
      firstCyclePromise,
      secondCyclePromise,
    ]);

    expect(firstResult).toEqual(secondResult);

    expect(firstResult).toMatchObject({
      candidates: 1,

      recovered: 1,

      failed: 0,
    });

    /*
     * Most important assertion:
     *
     * two cycle requests
     * ≠
     * two reconciliation attempts
     */
    expect(processor).toHaveBeenCalledTimes(1);
  });

  /*
|--------------------------------------------------------------------------
| 9. Cycle Lock Is Released After Failure
|--------------------------------------------------------------------------
*/

  it("allows a later reconciliation cycle after the previous cycle fails", async () => {
    const failingFinder = vi
      .fn()
      .mockRejectedValue(new Error("Temporary reconciliation query failure"));

    await expect(
      runPaymentReconciliationWorkerCycle({
        finder: failingFinder,
      }),
    ).rejects.toThrow("Temporary reconciliation query failure");

    /*
  |--------------------------------------------------------------------------
  | Next Cycle Must Still Be Allowed
  |--------------------------------------------------------------------------
  */

    const healthyFinder = vi.fn().mockResolvedValue([]);

    const result = await runPaymentReconciliationWorkerCycle({
      finder: healthyFinder,
    });

    expect(healthyFinder).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      candidates: 0,

      recovered: 0,

      alreadyFinalized: 0,

      manualReview: 0,

      skipped: 0,

      failed: 0,

      idle: true,

      limitReached: false,
    });
  });

  /*
|--------------------------------------------------------------------------
| 10. Start / Stop Are Idempotent
|--------------------------------------------------------------------------
*/

  it("starts and stops the reconciliation worker idempotently", async () => {
    const firstStart = startPaymentReconciliationWorker({
      intervalMs: 60_000,

      batchSize: 1,
    });

    expect(firstStart).toEqual({
      started: true,
    });

    /*
  |--------------------------------------------------------------------------
  | Duplicate Startup Must Not Create Another Scheduler
  |--------------------------------------------------------------------------
  */

    const secondStart = startPaymentReconciliationWorker({
      intervalMs: 60_000,

      batchSize: 1,
    });

    expect(secondStart).toEqual({
      started: false,

      reason: "already-started",
    });

    /*
     * stop() also waits for the immediate startup reconciliation cycle,
     * if that cycle is still running.
     */
    const firstStop = await stopPaymentReconciliationWorker();

    expect(firstStop).toEqual({
      stopped: true,
    });

    const secondStop = await stopPaymentReconciliationWorker();

    expect(secondStop).toEqual({
      stopped: false,

      reason: "not-started",
    });
  });

  /*
|--------------------------------------------------------------------------
| 11. Graceful Shutdown Waits For Active Reconciliation
|--------------------------------------------------------------------------
*/

  it("waits for an active reconciliation cycle before stopping", async () => {
    /*
  |--------------------------------------------------------------------------
  | Start Worker
  |--------------------------------------------------------------------------
  */

    startPaymentReconciliationWorker({
      intervalMs: 60_000,

      batchSize: 1,
    });

    /*
     * Wait for any immediate startup cycle to finish first.
     *
     * Calling run...() here either joins that startup cycle or runs one
     * empty cycle itself.
     */
    await runPaymentReconciliationWorkerCycle();

    /*
  |--------------------------------------------------------------------------
  | Start Controlled Slow Cycle
  |--------------------------------------------------------------------------
  */

    let releaseProcessor;

    const processorGate = new Promise((resolve) => {
      releaseProcessor = resolve;
    });

    const finder = vi.fn().mockResolvedValue([
      {
        _id: "66aa00000000000000000911",

        paymentNumber: "PAY-SHUTDOWN-001",

        order: "66aa00000000000000000912",

        orderNumber: "ORD-SHUTDOWN-001",
      },
    ]);

    const processor = vi.fn().mockImplementation(async () => {
      await processorGate;

      return {
        action: PAYMENT_RECONCILIATION_ACTIONS.RECOVERED,
      };
    });

    const activeCycle = runPaymentReconciliationWorkerCycle({
      maxPayments: 1,

      finder,

      processor,
    });

    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledTimes(1);
    });

    /*
  |--------------------------------------------------------------------------
  | Begin Shutdown While Recovery Is Still Running
  |--------------------------------------------------------------------------
  */

    let stopResolved = false;

    const stopPromise = stopPaymentReconciliationWorker().then((result) => {
      stopResolved = true;

      return result;
    });

    /*
     * Give stop() a chance to reach its await activeCyclePromise.
     */
    await Promise.resolve();

    expect(stopResolved).toBe(false);

    /*
  |--------------------------------------------------------------------------
  | Finish Recovery
  |--------------------------------------------------------------------------
  */

    releaseProcessor();

    await activeCycle;

    const stopResult = await stopPromise;

    expect(stopResult).toEqual({
      stopped: true,
    });

    expect(stopResolved).toBe(true);
  });
});
