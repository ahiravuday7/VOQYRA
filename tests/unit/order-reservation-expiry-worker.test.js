import { describe, expect, it, vi } from "vitest";

import { processExpiredOrderReservationBatch } from "../../src/modules/orders/order-reservation-expiry-worker.service.js";

/*
|--------------------------------------------------------------------------
| Part 203 — Order Reservation Expiry Worker
|--------------------------------------------------------------------------
*/

describe("Order reservation expiry worker", () => {
  it("returns idle when no expired reservations are available", async () => {
    const finder = vi.fn().mockResolvedValue([]);

    const processor = vi.fn();

    const result = await processExpiredOrderReservationBatch({
      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledTimes(1);

    expect(processor).not.toHaveBeenCalled();

    expect(result).toEqual({
      candidates: 0,

      expired: 0,

      skipped: 0,

      failed: 0,

      idle: true,

      limitReached: false,
    });
  });

  it("processes every candidate only once", async () => {
    const candidates = [
      {
        _id: "66aa00000000000000000001",

        orderNumber: "ORD-WORKER-001",
      },

      {
        _id: "66aa00000000000000000002",

        orderNumber: "ORD-WORKER-002",
      },
    ];

    const finder = vi.fn().mockResolvedValue(candidates);

    const processor = vi.fn().mockResolvedValue({
      action: "expire",
    });

    const result = await processExpiredOrderReservationBatch({
      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledTimes(1);

    expect(processor).toHaveBeenCalledTimes(2);

    expect(result.expired).toBe(2);

    expect(result.skipped).toBe(0);

    expect(result.failed).toBe(0);
  });

  it("does not repeatedly process a skipped authorized-payment Order", async () => {
    const candidate = {
      _id: "66aa00000000000000000003",

      orderNumber: "ORD-WORKER-003",
    };

    const finder = vi.fn().mockResolvedValue([candidate]);

    const processor = vi.fn().mockResolvedValue({
      action: "skip",

      reason: "payment-state-blocks-expiry",
    });

    const result = await processExpiredOrderReservationBatch({
      finder,

      processor,
    });

    expect(finder).toHaveBeenCalledTimes(1);

    expect(processor).toHaveBeenCalledTimes(1);

    expect(result.skipped).toBe(1);
  });

  it("continues processing when one expired Order fails", async () => {
    const finder = vi.fn().mockResolvedValue([
      {
        _id: "66aa00000000000000000004",

        orderNumber: "ORD-WORKER-004",
      },

      {
        _id: "66aa00000000000000000005",

        orderNumber: "ORD-WORKER-005",
      },
    ]);

    const processor = vi
      .fn()
      .mockRejectedValueOnce(new Error("Inventory release failed"))
      .mockResolvedValueOnce({
        action: "expire",
      });

    const result = await processExpiredOrderReservationBatch({
      finder,

      processor,
    });

    expect(processor).toHaveBeenCalledTimes(2);

    expect(result.failed).toBe(1);

    expect(result.expired).toBe(1);
  });

  it("reports when the configured reservation-expiry batch limit is reached", async () => {
    const finder = vi.fn().mockResolvedValue([
      {
        _id: "66aa00000000000000000006",
      },

      {
        _id: "66aa00000000000000000007",
      },
    ]);

    const processor = vi.fn().mockResolvedValue({
      action: "expire",
    });

    const result = await processExpiredOrderReservationBatch({
      maxOrders: 2,

      finder,

      processor,
    });

    expect(result.candidates).toBe(2);

    expect(result.limitReached).toBe(true);
  });
});
