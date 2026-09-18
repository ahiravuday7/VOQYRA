/*
|--------------------------------------------------------------------------
| Allowed Seed Database
|--------------------------------------------------------------------------
|
| Development seed data must only be written to the explicitly approved
| development database.
|
*/

export const SEED_DATABASE_NAME = "VOQYRA";

/*
|--------------------------------------------------------------------------
| Assert Seed Environment
|--------------------------------------------------------------------------
*/

export const assertSeedEnvironment = (nodeEnv) => {
  if (nodeEnv === "production") {
    throw new Error("Database seeding is disabled in production.");
  }
};

/*
|--------------------------------------------------------------------------
| Assert Seed Database Target
|--------------------------------------------------------------------------
|
| MongoDB may successfully connect even when the URI points to an
| unintended database. Verify the actual connected database before any
| seed operation is allowed to write data.
|
*/

export const assertSeedDatabaseTarget = (databaseName) => {
  if (!databaseName) {
    throw new Error("Unable to determine the connected database for seeding.");
  }

  if (databaseName !== SEED_DATABASE_NAME) {
    throw new Error(
      `Database seeding is allowed only for "${SEED_DATABASE_NAME}". ` +
        `Connected database is "${databaseName}".`,
    );
  }
};
