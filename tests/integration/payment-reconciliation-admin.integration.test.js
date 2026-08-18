import mongoose from "mongoose";

import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import PaymentTransaction, {
  PAYMENT_RECONCILIATION_RECORD_STATUSES,
} from "../../src/modules/payments/payment.model.js";

import { PAYMENT_RECONCILIATION_REASONS } from "../../src/modules/payments/payment-reconciliation.service.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

/*
|--------------------------------------------------------------------------
| Part 206 — Admin Payment Reconciliation Observability
|--------------------------------------------------------------------------
*/

let reconciliationSequence = 0;

/*
|--------------------------------------------------------------------------
| Payment Reconciliation Fixture
|--------------------------------------------------------------------------
*/

const createPaymentReconciliationFixture = async ({
  customerId,

  reconciliationStatus = PAYMENT_RECONCILIATION_RECORD_STATUSES.MANUAL_REVIEW,

  reason = PAYMENT_RECONCILIATION_REASONS.ORDER_STATE_CONFLICT,

  detectedAt = new Date(),

  lastAttemptedAt = detectedAt,

  recoveredAt = null,

  attemptCount = 1,

  paymentNumber = null,

  orderNumber = null,

  providerPaymentId = null,

  providerOrderId = null,

  amount = 899,
} = {}) => {
  reconciliationSequence += 1;

  const suffix = String(reconciliationSequence).padStart(3, "0");

  const resolvedPaymentNumber = paymentNumber ?? `PAY-RECON-ADMIN-${suffix}`;

  const resolvedOrderNumber = orderNumber ?? `ORD-RECON-ADMIN-${suffix}`;

  const resolvedProviderPaymentId =
    providerPaymentId ?? `pay_recon_admin_${suffix}`;

  const resolvedProviderOrderId =
    providerOrderId ?? `order_recon_admin_${suffix}`;

  const resolvedRecoveredAt =
    reconciliationStatus === PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED
      ? (recoveredAt ?? detectedAt)
      : null;

  return PaymentTransaction.create({
    paymentNumber: resolvedPaymentNumber,

    order: new mongoose.Types.ObjectId(),

    orderNumber: resolvedOrderNumber,

    customer: customerId,

    provider: "razorpay",

    amount,

    currency: "INR",

    status: "paid",

    attemptNumber: 1,

    providerReference: {
      orderId: resolvedProviderOrderId,

      paymentId: resolvedProviderPaymentId,
    },

    initiatedAt: new Date(detectedAt.getTime() - 120_000),

    verifiedAt: new Date(detectedAt.getTime() - 90_000),

    paidAt: new Date(detectedAt.getTime() - 60_000),

    reconciliation: {
      status: reconciliationStatus,

      reason,

      detectedAt,

      lastAttemptedAt,

      attemptCount,

      recoveredAt: resolvedRecoveredAt,
    },

    createdBy: customerId,
  });
};

/*
|--------------------------------------------------------------------------
| Normal Payment Fixture
|--------------------------------------------------------------------------
|
| reconciliation.status = none
|
| Must never appear in the admin reconciliation endpoint.
|--------------------------------------------------------------------------
*/

const createNormalPaymentFixture = async ({ customerId } = {}) => {
  reconciliationSequence += 1;

  const suffix = String(reconciliationSequence).padStart(3, "0");

  return PaymentTransaction.create({
    paymentNumber: `PAY-NORMAL-${suffix}`,

    order: new mongoose.Types.ObjectId(),

    orderNumber: `ORD-NORMAL-${suffix}`,

    customer: customerId,

    provider: "razorpay",

    amount: 899,

    currency: "INR",

    status: "paid",

    attemptNumber: 1,

    providerReference: {
      orderId: `order_normal_${suffix}`,

      paymentId: `pay_normal_${suffix}`,
    },

    initiatedAt: new Date(),

    verifiedAt: new Date(),

    paidAt: new Date(),

    createdBy: customerId,
  });
};

describe("Admin Payment reconciliation operations", () => {
  /*
    |--------------------------------------------------------------------------
    | 1. Authentication
    |--------------------------------------------------------------------------
    */

  it("requires authentication", async () => {
    const response = await request(app).get(
      "/api/v1/admin/payment-reconciliations",
    );

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | 2. Authorization
    |--------------------------------------------------------------------------
    */

  it("rejects a customer from Payment reconciliation administration", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await agent.get("/api/v1/admin/payment-reconciliations");

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | 3. List Reconciliation Records
    |--------------------------------------------------------------------------
    */

  it("lists reconciliation records for an admin while excluding normal Payments", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const manualReview = await createPaymentReconciliationFixture({
      customerId: user._id,

      reconciliationStatus:
        PAYMENT_RECONCILIATION_RECORD_STATUSES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH,
    });

    const recovered = await createPaymentReconciliationFixture({
      customerId: user._id,

      reconciliationStatus: PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_REQUIRES_FINALIZATION,
    });

    const normalPayment = await createNormalPaymentFixture({
      customerId: user._id,
    });

    const response = await agent.get("/api/v1/admin/payment-reconciliations");

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.data.paymentReconciliations).toHaveLength(2);

    expect(response.body.data.pagination.totalItems).toBe(2);

    const paymentIds = response.body.data.paymentReconciliations.map(
      (payment) => payment.id,
    );

    expect(paymentIds).toContain(String(manualReview._id));

    expect(paymentIds).toContain(String(recovered._id));

    expect(paymentIds).not.toContain(String(normalPayment._id));
  });

  /*
    |--------------------------------------------------------------------------
    | 4. Manual Review Filter
    |--------------------------------------------------------------------------
    */

  it("filters manual-review reconciliation records", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const manualReview = await createPaymentReconciliationFixture({
      customerId: user._id,

      reconciliationStatus:
        PAYMENT_RECONCILIATION_RECORD_STATUSES.MANUAL_REVIEW,
    });

    await createPaymentReconciliationFixture({
      customerId: user._id,

      reconciliationStatus: PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_REQUIRES_FINALIZATION,
    });

    const response = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        status: "manual-review",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.paymentReconciliations).toHaveLength(1);

    expect(response.body.data.paymentReconciliations[0].id).toBe(
      String(manualReview._id),
    );

    expect(
      response.body.data.paymentReconciliations[0].reconciliation.status,
    ).toBe("manual-review");

    expect(response.body.data.filters.status).toBe("manual-review");
  });

  /*
    |--------------------------------------------------------------------------
    | 5. Recovered Filter
    |--------------------------------------------------------------------------
    */

  it("filters successfully recovered reconciliation records", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    await createPaymentReconciliationFixture({
      customerId: user._id,

      reconciliationStatus:
        PAYMENT_RECONCILIATION_RECORD_STATUSES.MANUAL_REVIEW,
    });

    const recovered = await createPaymentReconciliationFixture({
      customerId: user._id,

      reconciliationStatus: PAYMENT_RECONCILIATION_RECORD_STATUSES.RECOVERED,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_REQUIRES_FINALIZATION,
    });

    const response = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        status: "recovered",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.paymentReconciliations).toHaveLength(1);

    expect(response.body.data.paymentReconciliations[0].id).toBe(
      String(recovered._id),
    );

    expect(
      response.body.data.paymentReconciliations[0].reconciliation.status,
    ).toBe("recovered");
  });

  /*
    |--------------------------------------------------------------------------
    | 6. Reason Filter
    |--------------------------------------------------------------------------
    */

  it("filters reconciliation records by reason", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const amountMismatch = await createPaymentReconciliationFixture({
      customerId: user._id,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH,
    });

    await createPaymentReconciliationFixture({
      customerId: user._id,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_STATE_CONFLICT,
    });

    const response = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH,
      });

    expect(response.status).toBe(200);

    expect(response.body.data.paymentReconciliations).toHaveLength(1);

    expect(response.body.data.paymentReconciliations[0].id).toBe(
      String(amountMismatch._id),
    );

    expect(
      response.body.data.paymentReconciliations[0].reconciliation.reason,
    ).toBe(PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH);
  });

  /*
    |--------------------------------------------------------------------------
    | 7. Provider Payment Reference Filter
    |--------------------------------------------------------------------------
    */

  it("filters reconciliation records by provider Payment ID", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const target = await createPaymentReconciliationFixture({
      customerId: user._id,

      providerPaymentId: "pay_admin_reconciliation_target",
    });

    await createPaymentReconciliationFixture({
      customerId: user._id,

      providerPaymentId: "pay_admin_reconciliation_other",
    });

    const response = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        providerPaymentId: "pay_admin_reconciliation_target",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.paymentReconciliations).toHaveLength(1);

    expect(response.body.data.paymentReconciliations[0].id).toBe(
      String(target._id),
    );

    expect(response.body.data.paymentReconciliations[0].providerPaymentId).toBe(
      "pay_admin_reconciliation_target",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | 8. Pagination + Sorting
    |--------------------------------------------------------------------------
    */

  it("paginates reconciliation records using detection time sorting", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const first = await createPaymentReconciliationFixture({
      customerId: user._id,

      paymentNumber: "PAY-RECON-SORT-001",

      detectedAt: new Date("2026-08-18T01:00:00.000Z"),
    });

    const second = await createPaymentReconciliationFixture({
      customerId: user._id,

      paymentNumber: "PAY-RECON-SORT-002",

      detectedAt: new Date("2026-08-18T02:00:00.000Z"),
    });

    const third = await createPaymentReconciliationFixture({
      customerId: user._id,

      paymentNumber: "PAY-RECON-SORT-003",

      detectedAt: new Date("2026-08-18T03:00:00.000Z"),
    });

    const firstPage = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        page: 1,

        limit: 2,

        sortDirection: "asc",
      });

    expect(firstPage.status).toBe(200);

    expect(
      firstPage.body.data.paymentReconciliations.map((payment) => payment.id),
    ).toEqual([String(first._id), String(second._id)]);

    expect(firstPage.body.data.pagination).toEqual({
      page: 1,

      limit: 2,

      totalItems: 3,

      totalPages: 2,

      hasPreviousPage: false,

      hasNextPage: true,
    });

    const secondPage = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        page: 2,

        limit: 2,

        sortDirection: "asc",
      });

    expect(secondPage.status).toBe(200);

    expect(secondPage.body.data.paymentReconciliations).toHaveLength(1);

    expect(secondPage.body.data.paymentReconciliations[0].id).toBe(
      String(third._id),
    );

    expect(secondPage.body.data.pagination.hasPreviousPage).toBe(true);

    expect(secondPage.body.data.pagination.hasNextPage).toBe(false);
  });

  /*
    |--------------------------------------------------------------------------
    | 9. Safe Response
    |--------------------------------------------------------------------------
    */

  it("returns only safe operational Payment reconciliation data", async () => {
    const { agent, user } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const payment = await createPaymentReconciliationFixture({
      customerId: user._id,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH,

      attemptCount: 2,
    });

    const response = await agent.get("/api/v1/admin/payment-reconciliations");

    expect(response.status).toBe(200);

    const result = response.body.data.paymentReconciliations[0];

    expect(result.id).toBe(String(payment._id));

    expect(result.paymentStatus).toBe("paid");

    expect(result.provider).toBe("razorpay");

    expect(result.reconciliation.status).toBe("manual-review");

    expect(result.reconciliation.attemptCount).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Internal / Sensitive Fields Must Not Leak
        |--------------------------------------------------------------------------
        */

    expect(result.createdBy).toBeUndefined();

    expect(result.failure).toBeUndefined();

    expect(result.refund).toBeUndefined();

    expect(result.providerReference).toBeUndefined();
  });

  /*
    |--------------------------------------------------------------------------
    | 10. Invalid Status
    |--------------------------------------------------------------------------
    */

  it("rejects an invalid reconciliation status", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const response = await agent
      .get("/api/v1/admin/payment-reconciliations")
      .query({
        status: "none",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });
});
