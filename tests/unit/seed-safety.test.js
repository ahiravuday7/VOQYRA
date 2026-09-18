import { describe, expect, it } from "vitest";

import {
  SEED_DATABASE_NAME,
  assertSeedDatabaseTarget,
  assertSeedEnvironment,
} from "../../src/seeds/seed-safety.js";

/*
|--------------------------------------------------------------------------
| Seed Environment Safety
|--------------------------------------------------------------------------
*/

describe("Seed environment safety", () => {
  it("allows development environment", () => {
    expect(() => assertSeedEnvironment("development")).not.toThrow();
  });

  it("allows test environment", () => {
    expect(() => assertSeedEnvironment("test")).not.toThrow();
  });

  it("rejects production environment", () => {
    expect(() => assertSeedEnvironment("production")).toThrow(
      "Database seeding is disabled in production.",
    );
  });
});

/*
|--------------------------------------------------------------------------
| Seed Database Target Safety
|--------------------------------------------------------------------------
*/

describe("Seed database target safety", () => {
  it("allows the approved seed database", () => {
    expect(SEED_DATABASE_NAME).toBe("VOQYRA");

    expect(() => assertSeedDatabaseTarget("VOQYRA")).not.toThrow();
  });

  it("rejects a different database", () => {
    expect(() => assertSeedDatabaseTarget("wrong-database")).toThrow(
      'Database seeding is allowed only for "VOQYRA". Connected database is "wrong-database".',
    );
  });

  it("rejects an empty database name", () => {
    expect(() => assertSeedDatabaseTarget("")).toThrow(
      "Unable to determine the connected database for seeding.",
    );
  });

  it("rejects an undefined database name", () => {
    expect(() => assertSeedDatabaseTarget(undefined)).toThrow(
      "Unable to determine the connected database for seeding.",
    );
  });
});
