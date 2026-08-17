import mongoose from "mongoose";

import { describe, expect, it } from "vitest";

import PaymentTransaction, {
  PAYMENT_PROVIDERS,
  PAYMENT_TRANSACTION_STATUSES,
} from "../../src/modules/payments/payment.model.js";

import { synchronizeCustomerPaymentProviderState } from "../../src/modules/payments/payment.service.js";

import { setTestRazorpayPaymentDetails } from "../helpers/payment-provider-test.helper.js";

/*
|--------------------------------------------------------------------------
| Part 190 — Payment Provider State Synchronization
|--------------------------------------------------------------------------
*/

const createVerifiedPaymentTransactionFixture = async ({
  status = PAYMENT_TRANSACTION_STATUSES.PENDING,

  verified = true,
} = {}) => {
  const suffix = new mongoose.Types.ObjectId().toString();

  const orderId = new mongoose.Types.ObjectId();

  const customerId = new mongoose.Types.ObjectId();

  const providerOrderId = `order_test_${suffix}`;

  const providerPaymentId = `pay_test_${suffix}`;

  /*
    |--------------------------------------------------------------------------
    | Existing Lifecycle Values
    |--------------------------------------------------------------------------
    */

  const authorizedAt =
    status === PAYMENT_TRANSACTION_STATUSES.AUTHORIZED
      ? new Date("2026-08-17T05:00:00.000Z")
      : null;

  const paidAt =
    status === PAYMENT_TRANSACTION_STATUSES.PAID
      ? new Date("2026-08-17T05:05:00.000Z")
      : null;

  /*
    |--------------------------------------------------------------------------
    | Create Verified Transaction
    |--------------------------------------------------------------------------
    */

  const paymentTransaction = await PaymentTransaction.create({
    paymentNumber: `PAY-T190-${suffix.slice(-12)}`,

    order: orderId,

    orderNumber: `ORD-T190-${suffix.slice(-12)}`,

    customer: customerId,

    provider: PAYMENT_PROVIDERS.RAZORPAY,

    amount: 899,

    currency: "INR",

    status,

    attemptNumber: 1,

    providerReference: {
      orderId: providerOrderId,

      paymentId: providerPaymentId,

      signature: "a".repeat(64),
    },

    initiatedAt: new Date("2026-08-17T04:55:00.000Z"),

    verifiedAt: verified ? new Date("2026-08-17T04:59:00.000Z") : null,

    authorizedAt,

    paidAt,

    createdBy: customerId,
  });

  return {
    orderId,

    customerId,

    providerOrderId,

    providerPaymentId,

    paymentTransaction,
  };
};

/*
|--------------------------------------------------------------------------
| Tests
|--------------------------------------------------------------------------
*/

describe("Payment provider state synchronization", () => {
  /*
    |--------------------------------------------------------------------------
    | 1. Verification Required
    |--------------------------------------------------------------------------
    */

  it("rejects provider synchronization before Checkout confirmation is verified", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture({
      verified: false,
    });

    await expect(
      synchronizeCustomerPaymentProviderState({
        orderId: fixture.orderId,

        paymentTransactionId: fixture.paymentTransaction._id,

        customerId: fixture.customerId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,

      errorCode: "PAYMENT_PROVIDER_VERIFICATION_REQUIRED",
    });
  });

  /*
    |--------------------------------------------------------------------------
    | 2. Created → Pending
    |--------------------------------------------------------------------------
    */

  it("keeps a provider-created Payment pending", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture();

    setTestRazorpayPaymentDetails({
      providerPaymentId: fixture.providerPaymentId,

      providerOrderId: fixture.providerOrderId,

      amount: 899,

      currency: "INR",

      status: "created",

      captured: false,

      method: "upi",
    });

    const result = await synchronizeCustomerPaymentProviderState({
      orderId: fixture.orderId,

      paymentTransactionId: fixture.paymentTransaction._id,

      customerId: fixture.customerId,
    });

    expect(result.action).toBe("pending");

    expect(result.paymentTransaction.status).toBe(
      PAYMENT_TRANSACTION_STATUSES.PENDING,
    );

    const storedPayment = await PaymentTransaction.findById(
      fixture.paymentTransaction._id,
    ).lean();

    expect(storedPayment.status).toBe(PAYMENT_TRANSACTION_STATUSES.PENDING);

    expect(storedPayment.authorizedAt).toBeNull();

    expect(storedPayment.paidAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | 3. Pending → Authorized
    |--------------------------------------------------------------------------
    */

  it("moves a verified pending Payment to authorized", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture();

    setTestRazorpayPaymentDetails({
      providerPaymentId: fixture.providerPaymentId,

      providerOrderId: fixture.providerOrderId,

      amount: 899,

      currency: "INR",

      status: "authorized",

      captured: false,

      method: "upi",
    });

    const result = await synchronizeCustomerPaymentProviderState({
      orderId: fixture.orderId,

      paymentTransactionId: fixture.paymentTransaction._id,

      customerId: fixture.customerId,
    });

    expect(result.action).toBe("authorize");

    expect(result.paymentTransaction.status).toBe(
      PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,
    );

    expect(result.paymentTransaction.authorizedAt).toBeInstanceOf(Date);

    expect(result.paymentTransaction.paidAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | 4. Pending → Paid
    |--------------------------------------------------------------------------
    */

  it("moves a verified pending Payment directly to paid when Razorpay reports captured", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture();

    setTestRazorpayPaymentDetails({
      providerPaymentId: fixture.providerPaymentId,

      providerOrderId: fixture.providerOrderId,

      amount: 899,

      currency: "INR",

      status: "captured",

      captured: true,

      method: "upi",
    });

    const result = await synchronizeCustomerPaymentProviderState({
      orderId: fixture.orderId,

      paymentTransactionId: fixture.paymentTransaction._id,

      customerId: fixture.customerId,
    });

    expect(result.action).toBe("pay");

    expect(result.paymentTransaction.status).toBe(
      PAYMENT_TRANSACTION_STATUSES.PAID,
    );

    expect(result.paymentTransaction.paidAt).toBeInstanceOf(Date);
  });

  /*
    |--------------------------------------------------------------------------
    | 5. Authorized → Paid
    |--------------------------------------------------------------------------
    */

  it("moves an authorized Payment forward to paid without losing authorizedAt", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture({
      status: PAYMENT_TRANSACTION_STATUSES.AUTHORIZED,
    });

    const originalAuthorizedAt = fixture.paymentTransaction.authorizedAt;

    setTestRazorpayPaymentDetails({
      providerPaymentId: fixture.providerPaymentId,

      providerOrderId: fixture.providerOrderId,

      amount: 899,

      currency: "INR",

      status: "captured",

      captured: true,

      method: "card",
    });

    const result = await synchronizeCustomerPaymentProviderState({
      orderId: fixture.orderId,

      paymentTransactionId: fixture.paymentTransaction._id,

      customerId: fixture.customerId,
    });

    expect(result.action).toBe("pay");

    expect(result.paymentTransaction.status).toBe(
      PAYMENT_TRANSACTION_STATUSES.PAID,
    );

    expect(result.paymentTransaction.authorizedAt).toEqual(
      originalAuthorizedAt,
    );

    expect(result.paymentTransaction.paidAt).toBeInstanceOf(Date);
  });

  /*
    |--------------------------------------------------------------------------
    | 6. Never Downgrade Paid
    |--------------------------------------------------------------------------
    */

  it("never downgrades a locally paid Payment when a stale provider observation says authorized", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture({
      status: PAYMENT_TRANSACTION_STATUSES.PAID,
    });

    const originalPaidAt = fixture.paymentTransaction.paidAt;

    setTestRazorpayPaymentDetails({
      providerPaymentId: fixture.providerPaymentId,

      providerOrderId: fixture.providerOrderId,

      amount: 899,

      currency: "INR",

      status: "authorized",

      captured: false,

      method: "upi",
    });

    const result = await synchronizeCustomerPaymentProviderState({
      orderId: fixture.orderId,

      paymentTransactionId: fixture.paymentTransaction._id,

      customerId: fixture.customerId,
    });

    expect(result.action).toBe("reuse");

    expect(result.paymentTransaction.status).toBe(
      PAYMENT_TRANSACTION_STATUSES.PAID,
    );

    expect(result.paymentTransaction.paidAt).toEqual(originalPaidAt);
  });

  /*
    |--------------------------------------------------------------------------
    | 7. Failed Provider State
    |--------------------------------------------------------------------------
    */

  it("rejects failed or otherwise non-payable provider states without changing local payment state", async () => {
    const fixture = await createVerifiedPaymentTransactionFixture();

    setTestRazorpayPaymentDetails({
      providerPaymentId: fixture.providerPaymentId,

      providerOrderId: fixture.providerOrderId,

      amount: 899,

      currency: "INR",

      status: "failed",

      captured: false,

      method: "upi",
    });

    await expect(
      synchronizeCustomerPaymentProviderState({
        orderId: fixture.orderId,

        paymentTransactionId: fixture.paymentTransaction._id,

        customerId: fixture.customerId,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,

      errorCode: "PAYMENT_PROVIDER_STATE_INVALID",
    });

    const storedPayment = await PaymentTransaction.findById(
      fixture.paymentTransaction._id,
    ).lean();

    expect(storedPayment.status).toBe(PAYMENT_TRANSACTION_STATUSES.PENDING);

    expect(storedPayment.paidAt).toBeNull();
  });
});
