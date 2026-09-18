import mongoose from "mongoose";

import connectDatabase from "../config/database.js";
import env from "../config/environment.js";
import logger from "../config/logger.js";

import { seedDevelopmentUsers } from "./dev-user.seed.js";

import {
  assertSeedDatabaseTarget,
  assertSeedEnvironment,
} from "./seed-safety.js";

/*
|--------------------------------------------------------------------------
| Development User Seed Configuration
|--------------------------------------------------------------------------
*/

const getDevelopmentUserSeedConfig = () => {
  const config = {
    adminEmail: process.env.DEV_SEED_ADMIN_EMAIL?.trim(),

    adminPassword: process.env.DEV_SEED_ADMIN_PASSWORD,

    customerEmail: process.env.DEV_SEED_CUSTOMER_EMAIL?.trim(),

    customerPassword: process.env.DEV_SEED_CUSTOMER_PASSWORD,
  };

  const missingVariables = [];

  if (!config.adminEmail) {
    missingVariables.push("DEV_SEED_ADMIN_EMAIL");
  }

  if (!config.adminPassword) {
    missingVariables.push("DEV_SEED_ADMIN_PASSWORD");
  }

  if (!config.customerEmail) {
    missingVariables.push("DEV_SEED_CUSTOMER_EMAIL");
  }

  if (!config.customerPassword) {
    missingVariables.push("DEV_SEED_CUSTOMER_PASSWORD");
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing development-user seed variables: ${missingVariables.join(", ")}`,
    );
  }

  return config;
};

/*
|--------------------------------------------------------------------------
| Run Development User Seed
|--------------------------------------------------------------------------
*/

const runDevelopmentUserSeed = async () => {
  /*
   * Block production before connecting to MongoDB.
   */
  assertSeedEnvironment(env.NODE_ENV);

  /*
   * Validate credentials before connecting.
   */
  const seedConfig = getDevelopmentUserSeedConfig();

  await connectDatabase();

  /*
   * Verify the actual connected database.
   */
  assertSeedDatabaseTarget(mongoose.connection.name);

  logger.info(
    {
      environment: env.NODE_ENV,
      database: mongoose.connection.name,
    },
    "Development-user seed database target verified",
  );

  const { admin, customer } = await seedDevelopmentUsers(seedConfig);

  logger.info(
    {
      admin: {
        id: admin._id,
        email: admin.email,
        role: admin.role,
      },

      customer: {
        id: customer._id,
        email: customer.email,
        role: customer.role,
      },
    },
    "Development users seeded successfully",
  );
};

/*
|--------------------------------------------------------------------------
| Development User Seed Process
|--------------------------------------------------------------------------
*/

const main = async () => {
  try {
    await runDevelopmentUserSeed();
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Development-user seed failed",
    );

    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();

      logger.info("MongoDB disconnected after development-user seed");
    }
  }
};

void main();
