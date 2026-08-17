import mongoose from "mongoose";

import { describe, expect, it } from "vitest";

import ProductInventoryLedger from "../../src/modules/products/product-inventory-ledger.model.js";

import { toAdminProductInventoryLedgerEntry } from "../../src/modules/products/product-inventory-ledger.mapper.js";

import {
  AUDIT_ACTOR_TYPES,
  SYSTEM_AUDIT_ACTORS,
} from "../../src/shared/constants/audit.constants.js";

/*
|--------------------------------------------------------------------------
| Part 201 — System Audit Actor
|--------------------------------------------------------------------------
*/

const createInventoryState = ({
  stock,

  reservedStock,
}) => {
  return {
    stock,

    reservedStock,

    availableStock: stock - reservedStock,
  };
};

describe("System audit actor foundation", () => {
  /*
    |--------------------------------------------------------------------------
    | System Ledger Entry
    |--------------------------------------------------------------------------
    */

  it("allows an inventory ledger entry to be created by a system actor without a User ID", async () => {
    const ledgerEntry = await ProductInventoryLedger.create({
      product: new mongoose.Types.ObjectId(),

      variantId: new mongoose.Types.ObjectId(),

      sku: "TSHIRT-BLK-S",

      operation: "release",

      quantity: 2,

      stockDelta: 0,

      reservedStockDelta: -2,

      before: createInventoryState({
        stock: 20,

        reservedStock: 2,
      }),

      after: createInventoryState({
        stock: 20,

        reservedStock: 0,
      }),

      note: "Inventory reservation expired",

      referenceId: "ORD-SYSTEM-001",

      actorType: AUDIT_ACTOR_TYPES.SYSTEM,

      systemActor: SYSTEM_AUDIT_ACTORS.ORDER_RESERVATION_EXPIRY,

      actor: null,
    });

    expect(ledgerEntry.actorType).toBe("system");

    expect(ledgerEntry.actor).toBeNull();

    expect(ledgerEntry.systemActor).toBe("order-reservation-expiry-worker");
  });

  /*
    |--------------------------------------------------------------------------
    | Mapper
    |--------------------------------------------------------------------------
    */

  it("maps system inventory audit information safely for admins", async () => {
    const ledgerEntry = await ProductInventoryLedger.create({
      product: new mongoose.Types.ObjectId(),

      variantId: new mongoose.Types.ObjectId(),

      sku: "TSHIRT-BLK-M",

      operation: "release",

      quantity: 1,

      stockDelta: 0,

      reservedStockDelta: -1,

      before: createInventoryState({
        stock: 15,

        reservedStock: 1,
      }),

      after: createInventoryState({
        stock: 15,

        reservedStock: 0,
      }),

      note: "Inventory reservation expired",

      referenceId: "ORD-SYSTEM-002",

      actorType: AUDIT_ACTOR_TYPES.SYSTEM,

      systemActor: SYSTEM_AUDIT_ACTORS.ORDER_RESERVATION_EXPIRY,
    });

    const mapped = toAdminProductInventoryLedgerEntry(ledgerEntry);

    expect(mapped.actorType).toBe("system");

    expect(mapped.actorId).toBeNull();

    expect(mapped.systemActor).toBe("order-reservation-expiry-worker");
  });

  /*
    |--------------------------------------------------------------------------
    | Human Actor Backward Compatibility
    |--------------------------------------------------------------------------
    */

  it("continues to support existing User-based inventory audit entries", async () => {
    const userId = new mongoose.Types.ObjectId();

    const ledgerEntry = await ProductInventoryLedger.create({
      product: new mongoose.Types.ObjectId(),

      variantId: new mongoose.Types.ObjectId(),

      sku: "TSHIRT-BLK-L",

      operation: "release",

      quantity: 1,

      stockDelta: 0,

      reservedStockDelta: -1,

      before: createInventoryState({
        stock: 10,

        reservedStock: 1,
      }),

      after: createInventoryState({
        stock: 10,

        reservedStock: 0,
      }),

      note: "Customer cancellation",

      referenceId: "ORD-USER-001",

      /*
       * actorType intentionally omitted.
       *
       * Existing application code works
       * through default = user.
       */
      actor: userId,
    });

    expect(ledgerEntry.actorType).toBe(AUDIT_ACTOR_TYPES.USER);

    expect(String(ledgerEntry.actor)).toBe(String(userId));

    expect(ledgerEntry.systemActor).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid System Actor
    |--------------------------------------------------------------------------
    */

  it("rejects a system ledger entry without a registered system actor", async () => {
    const ledgerEntry = new ProductInventoryLedger({
      product: new mongoose.Types.ObjectId(),

      variantId: new mongoose.Types.ObjectId(),

      sku: "TSHIRT-RED-S",

      operation: "release",

      quantity: 1,

      stockDelta: 0,

      reservedStockDelta: -1,

      before: createInventoryState({
        stock: 5,

        reservedStock: 1,
      }),

      after: createInventoryState({
        stock: 5,

        reservedStock: 0,
      }),

      actorType: AUDIT_ACTOR_TYPES.SYSTEM,

      actor: null,

      systemActor: null,
    });

    await expect(ledgerEntry.validate()).rejects.toThrow();
  });
});
