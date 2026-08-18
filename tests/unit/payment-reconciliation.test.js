import { describe, expect, it } from "vitest";

import {
  PAYMENT_PROVIDERS,
  PAYMENT_TRANSACTION_STATUSES,
} from "../../src/modules/payments/payment.model.js";

import {
  ORDER_INVENTORY_STATUSES,
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
} from "../../src/shared/constants/order.constants.js";

import {
  classifyPaymentOrderReconciliationState,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATES,
} from "../../src/modules/payments/payment-reconciliation.service.js";

/*
|--------------------------------------------------------------------------
| Part 206 — Payment Recovery / Reconciliation
|--------------------------------------------------------------------------
*/

const ORDER_ID = "66aa00000000000000000101";

const CUSTOMER_ID = "66aa00000000000000000102";

const PAYMENT_ID = "66aa00000000000000000103";

/*
|--------------------------------------------------------------------------
| Recoverable Order Fixture
|--------------------------------------------------------------------------
*/

const createOrderFixture = ({
  status = ORDER_STATUSES.PENDING,

  paymentStatus = ORDER_PAYMENT_STATUSES.PENDING,

  paymentMethod = ORDER_PAYMENT_METHODS.ONLINE,

  inventoryStatus = ORDER_INVENTORY_STATUSES.RESERVED,

  customer = CUSTOMER_ID,

  amount = 899,

  currency = "INR",

  provider = undefined,

  transactionId = undefined,
} = {}) => {
  return {
    _id: ORDER_ID,

    customer,

    status,

    inventoryStatus,

    totals: {
      grandTotal: amount,

      currency,
    },

    payment: {
      method: paymentMethod,

      status: paymentStatus,

      provider,

      transactionId,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Paid Payment Fixture
|--------------------------------------------------------------------------
*/

const createPaymentFixture = ({
  status = PAYMENT_TRANSACTION_STATUSES.PAID,

  order = ORDER_ID,

  customer = CUSTOMER_ID,

  amount = 899,

  currency = "INR",

  provider = PAYMENT_PROVIDERS.RAZORPAY,

  providerOrderId = "order_reconciliation_test",

  providerPaymentId = "pay_reconciliation_test",

  verifiedAt = new Date("2026-08-18T04:00:00.000Z"),

  providerVerifiedAt = null,

  paidAt = new Date("2026-08-18T04:01:00.000Z"),
} = {}) => {
  return {
    _id: PAYMENT_ID,

    order,

    customer,

    provider,

    amount,

    currency,

    status,

    providerReference: {
      orderId: providerOrderId,

      paymentId: providerPaymentId,
    },

    verifiedAt,

    providerVerifiedAt,

    paidAt,
  };
};

describe("Payment reconciliation classification", () => {
  /*
  |--------------------------------------------------------------------------
  | 1. Recoverable
  |--------------------------------------------------------------------------
  */

  it("classifies a trusted paid Payment with a pending reserved Order as recoverable", () => {
    const order = createOrderFixture();

    const paymentTransaction = createPaymentFixture();

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.RECOVERABLE,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_REQUIRES_FINALIZATION,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 2. Provider Verification Is Also Trusted
  |--------------------------------------------------------------------------
  */

  it("accepts direct provider verification when browser verification is absent", () => {
    const order = createOrderFixture();

    const paymentTransaction = createPaymentFixture({
      verifiedAt: null,

      providerVerifiedAt: new Date("2026-08-18T04:00:00.000Z"),
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result.state).toBe(PAYMENT_RECONCILIATION_STATES.RECOVERABLE);
  });

  /*
  |--------------------------------------------------------------------------
  | 3. Non-Paid Transaction
  |--------------------------------------------------------------------------
  */

  it("ignores Payment transactions that are not paid", () => {
    const order = createOrderFixture();

    const paymentTransaction = createPaymentFixture({
      status: PAYMENT_TRANSACTION_STATUSES.PENDING,

      paidAt: null,
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.NOT_APPLICABLE,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_NOT_PAID,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 4. Paid But Untrusted
  |--------------------------------------------------------------------------
  */

  it("requires manual review when a paid Payment has no trusted verification", () => {
    const order = createOrderFixture();

    const paymentTransaction = createPaymentFixture({
      verifiedAt: null,

      providerVerifiedAt: null,
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_NOT_TRUSTED,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 5. Payment / Order Mismatch
  |--------------------------------------------------------------------------
  */

  it("requires manual review when the Payment belongs to another Order", () => {
    const order = createOrderFixture();

    const paymentTransaction = createPaymentFixture({
      order: "66aa00000000000000000999",
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_ORDER_MISMATCH,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 6. Customer Mismatch
  |--------------------------------------------------------------------------
  */

  it("requires manual review when the Payment belongs to another customer", () => {
    const order = createOrderFixture();

    const paymentTransaction = createPaymentFixture({
      customer: "66aa00000000000000000888",
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_CUSTOMER_MISMATCH,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 7. Amount Mismatch
  |--------------------------------------------------------------------------
  */

  it("requires manual review when trusted Payment amount does not match the Order", () => {
    const order = createOrderFixture({
      amount: 899,
    });

    const paymentTransaction = createPaymentFixture({
      amount: 999,
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_AMOUNT_MISMATCH,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 8. Currency Mismatch
  |--------------------------------------------------------------------------
  */

  it("requires manual review when trusted Payment currency does not match the Order", () => {
    const order = createOrderFixture({
      currency: "INR",
    });

    const paymentTransaction = createPaymentFixture({
      currency: "USD",
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.PAYMENT_CURRENCY_MISMATCH,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 9. Already Finalized
  |--------------------------------------------------------------------------
  */

  it("recognizes an already finalized paid Order", () => {
    const paymentTransaction = createPaymentFixture();

    const order = createOrderFixture({
      status: ORDER_STATUSES.CONFIRMED,

      paymentStatus: ORDER_PAYMENT_STATUSES.PAID,

      inventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,

      provider: PAYMENT_PROVIDERS.RAZORPAY,

      transactionId: paymentTransaction.providerReference.paymentId,
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.ALREADY_FINALIZED,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_ALREADY_FINALIZED,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 10. Progressed Order Is Still Finalized
  |--------------------------------------------------------------------------
  */

  it("recognizes a paid Order that already progressed beyond confirmed", () => {
    const paymentTransaction = createPaymentFixture();

    const order = createOrderFixture({
      status: ORDER_STATUSES.SHIPPED,

      paymentStatus: ORDER_PAYMENT_STATUSES.PAID,

      inventoryStatus: ORDER_INVENTORY_STATUSES.COMMITTED,

      provider: PAYMENT_PROVIDERS.RAZORPAY,

      transactionId: paymentTransaction.providerReference.paymentId,
    });

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result.state).toBe(PAYMENT_RECONCILIATION_STATES.ALREADY_FINALIZED);
  });

  /*
  |--------------------------------------------------------------------------
  | 11. Paid Payment + Cancelled Order
  |--------------------------------------------------------------------------
  */

  it("requires manual review instead of automatically recovering a cancelled released Order", () => {
    const order = createOrderFixture({
      status: ORDER_STATUSES.CANCELLED,

      inventoryStatus: ORDER_INVENTORY_STATUSES.RELEASED,
    });

    const paymentTransaction = createPaymentFixture();

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result).toEqual({
      state: PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW,

      reason: PAYMENT_RECONCILIATION_REASONS.ORDER_STATE_CONFLICT,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | 12. Paid Order With Wrong Inventory State
  |--------------------------------------------------------------------------
  */

  it("requires manual review when the Order payment state and inventory state conflict", () => {
    const order = createOrderFixture({
      paymentStatus: ORDER_PAYMENT_STATUSES.PAID,

      inventoryStatus: ORDER_INVENTORY_STATUSES.RESERVED,
    });

    const paymentTransaction = createPaymentFixture();

    const result = classifyPaymentOrderReconciliationState({
      order,

      paymentTransaction,
    });

    expect(result.state).toBe(PAYMENT_RECONCILIATION_STATES.MANUAL_REVIEW);

    expect(result.reason).toBe(
      PAYMENT_RECONCILIATION_REASONS.ORDER_STATE_CONFLICT,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | 13. Missing Order
  |--------------------------------------------------------------------------
  */

  it("rejects classification without an Order", () => {
    expect(() => {
      classifyPaymentOrderReconciliationState({
        order: null,

        paymentTransaction: createPaymentFixture(),
      });
    }).toThrow("Payment reconciliation requires an Order");
  });

  /*
  |--------------------------------------------------------------------------
  | 14. Missing Payment
  |--------------------------------------------------------------------------
  */

  it("rejects classification without a Payment transaction", () => {
    expect(() => {
      classifyPaymentOrderReconciliationState({
        order: createOrderFixture(),

        paymentTransaction: null,
      });
    }).toThrow("Payment reconciliation requires a Payment transaction");
  });
});
