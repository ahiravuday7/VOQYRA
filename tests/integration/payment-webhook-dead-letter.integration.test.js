import { describe, expect, it } from "vitest";

import PaymentWebhookEvent, {
  PAYMENT_WEBHOOK_PROCESSING_STATUSES,
} from "../../src/modules/payments/payment-webhook-event.model.js";

import { processNextPaymentWebhookEvent } from "../../src/modules/payments/payment-webhook-processor.service.js";

/*
|--------------------------------------------------------------------------
| Part 196 — Webhook Dead-Letter Handling
|--------------------------------------------------------------------------
*/

describe("Payment webhook dead-letter handling", () => {
  /*
    |--------------------------------------------------------------------------
    | Final Retry Exhaustion
    |--------------------------------------------------------------------------
    */

  it("dead-letters a webhook after its final automatic processing attempt", async () => {
    /*
        |--------------------------------------------------------------------------
        | Seven Attempts Have Already Failed
        |--------------------------------------------------------------------------
        |
        | The next claim becomes attempt #8.
        |--------------------------------------------------------------------------
        */

    const webhookEvent = await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_part196_exhausted",

      eventType: "payment.captured",

      payloadHash: "a".repeat(64),

      payment: {
        providerPaymentId: "pay_part196_missing",

        providerOrderId: "order_part196_missing",

        amountSubunits: 89900,

        currency: "INR",

        status: "captured",

        captured: true,

        method: "upi",
      },

      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,

      processingAttempts: 7,

      nextAttemptAt: new Date(Date.now() - 1_000),

      lastError: "Previous processing attempt failed",
    });

    /*
        |--------------------------------------------------------------------------
        | Attempt #8
        |--------------------------------------------------------------------------
        |
        | No PaymentTransaction exists for order_part196_missing,
        | therefore processing will fail again.
        |--------------------------------------------------------------------------
        */

    const result = await processNextPaymentWebhookEvent();

    expect(result.action).toBe("dead-lettered");

    expect(result.exhausted).toBe(true);

    expect(result.error.code).toBe(
      "PAYMENT_WEBHOOK_PAYMENT_TRANSACTION_NOT_FOUND",
    );

    /*
        |--------------------------------------------------------------------------
        | Database State
        |--------------------------------------------------------------------------
        */

    const storedEvent = await PaymentWebhookEvent.findById(
      webhookEvent._id,
    ).lean();

    expect(storedEvent.processingStatus).toBe(
      PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,
    );

    expect(storedEvent.processingAttempts).toBe(8);

    expect(storedEvent.deadLetteredAt).toBeInstanceOf(Date);

    expect(storedEvent.nextAttemptAt).toBeNull();

    expect(storedEvent.claimedAt).toBeNull();

    expect(storedEvent.lastError).toContain(
      "PAYMENT_WEBHOOK_PAYMENT_TRANSACTION_NOT_FOUND",
    );

    /*
        |--------------------------------------------------------------------------
        | Dead Letter Must Never Be Claimed Automatically
        |--------------------------------------------------------------------------
        */

    const secondResult = await processNextPaymentWebhookEvent();

    expect(secondResult.action).toBe("idle");

    /*
        |--------------------------------------------------------------------------
        | Attempts Must Stay At Eight
        |--------------------------------------------------------------------------
        */

    const afterSecondCycle = await PaymentWebhookEvent.findById(
      webhookEvent._id,
    ).lean();

    expect(afterSecondCycle.processingAttempts).toBe(8);
  });

  /*
    |--------------------------------------------------------------------------
    | Recover Old Exhausted Failed Event
    |--------------------------------------------------------------------------
    */

  it("automatically moves an already exhausted failed webhook into dead-letter state", async () => {
    const webhookEvent = await PaymentWebhookEvent.create({
      provider: "razorpay",

      providerEventId: "evt_part196_old_exhausted",

      eventType: "payment.captured",

      payloadHash: "b".repeat(64),

      payment: {
        providerPaymentId: "pay_part196_old",

        providerOrderId: "order_part196_old",

        amountSubunits: 89900,

        currency: "INR",

        status: "captured",

        captured: true,

        method: "upi",
      },

      /*
       * This represents data created by
       * the pre-Part-196 worker.
       */
      processingStatus: PAYMENT_WEBHOOK_PROCESSING_STATUSES.FAILED,

      processingAttempts: 8,

      nextAttemptAt: new Date(Date.now() - 60_000),

      lastError: "Legacy exhausted event",
    });

    /*
        |--------------------------------------------------------------------------
        | Worker Maintenance Pass
        |--------------------------------------------------------------------------
        */

    const result = await processNextPaymentWebhookEvent();

    /*
     * Maintenance dead-letters the exhausted record.
     * There are then no claimable events.
     */
    expect(result.action).toBe("idle");

    const storedEvent = await PaymentWebhookEvent.findById(
      webhookEvent._id,
    ).lean();

    expect(storedEvent.processingStatus).toBe(
      PAYMENT_WEBHOOK_PROCESSING_STATUSES.DEAD_LETTERED,
    );

    expect(storedEvent.deadLetteredAt).toBeInstanceOf(Date);

    expect(storedEvent.nextAttemptAt).toBeNull();
  });
});
