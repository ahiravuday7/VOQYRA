import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import env from "../config/environment.js";
import logger from "../config/logger.js";

import {
  assertSeedDatabaseTarget,
  assertSeedEnvironment,
} from "./seed-safety.js";

/*
|--------------------------------------------------------------------------
| Seed Preflight
|--------------------------------------------------------------------------
|
| Verify the environment and actual MongoDB database target without
| executing any seed operation.
|
*/

const runSeedPreflight = async () => {
  /*
  |--------------------------------------------------------------------------
  | Environment Safety
  |--------------------------------------------------------------------------
  */

  assertSeedEnvironment(env.NODE_ENV);

  /*
  |--------------------------------------------------------------------------
  | Database Connection
  |--------------------------------------------------------------------------
  */

  await connectDatabase();

  /*
  |--------------------------------------------------------------------------
  | Actual Database Target
  |--------------------------------------------------------------------------
  */

  assertSeedDatabaseTarget(mongoose.connection.name);

  logger.info(
    {
      environment: env.NODE_ENV,
      database: mongoose.connection.name,
      host: mongoose.connection.host,
    },
    "Seed preflight passed",
  );
};

/*
|--------------------------------------------------------------------------
| Preflight Process
|--------------------------------------------------------------------------
*/

const main = async () => {
  try {
    await runSeedPreflight();
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Seed preflight failed",
    );

    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();

      logger.info("MongoDB disconnected after seed preflight");
    }
  }
};

void main();
