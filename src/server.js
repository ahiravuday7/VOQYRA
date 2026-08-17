import mongoose from "mongoose";

import app from "./app.js";

import connectDatabase from "./config/database.js";
import env from "./config/environment.js";
import logger from "./config/logger.js";

import {
  startPaymentWebhookWorker,
  stopPaymentWebhookWorker,
} from "./modules/payments/payment-webhook-worker.service.js";

import {
  startOrderReservationExpiryWorker,
  stopOrderReservationExpiryWorker,
} from "./modules/orders/order-reservation-expiry-worker.service.js";

/*
|--------------------------------------------------------------------------
| Server State
|--------------------------------------------------------------------------
*/

let httpServer = null;

let shuttingDown = false;

/*
|--------------------------------------------------------------------------
| Start Application
|--------------------------------------------------------------------------
*/

const startServer = async () => {
  try {
    /*
      |--------------------------------------------------------------------------
      | Database
      |--------------------------------------------------------------------------
      */

    await connectDatabase();

    /*
      |--------------------------------------------------------------------------
      | HTTP Server
      |--------------------------------------------------------------------------
      */

    httpServer = app.listen(
      env.PORT,

      () => {
        logger.info(
          {
            port: env.PORT,

            environment: env.NODE_ENV,
          },

          "Clothing Commerce API started",
        );
      },
    );

    /*
      |--------------------------------------------------------------------------
      | Payment Webhook Worker
      |--------------------------------------------------------------------------
      |
      | Start only after:
      |
      | MongoDB connected ✅
      | HTTP server created ✅
      |--------------------------------------------------------------------------
      */

    startPaymentWebhookWorker();
    startOrderReservationExpiryWorker();
  } catch (error) {
    logger.fatal(
      {
        err: error,
      },

      "Application startup failed",
    );

    process.exit(1);
  }
};

/*
|--------------------------------------------------------------------------
| Close HTTP Server
|--------------------------------------------------------------------------
*/

const closeHttpServer = async () => {
  if (!httpServer) {
    return;
  }

  await new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });

  httpServer = null;
};

/*
|--------------------------------------------------------------------------
| Graceful Shutdown
|--------------------------------------------------------------------------
*/

const shutdown = async (signal) => {
  try {
    logger.info(
      {
        signal,
      },
      "Graceful shutdown started",
    );

    /*
    |--------------------------------------------------------------------------
    | Stop Background Workers
    |--------------------------------------------------------------------------
    */

    await Promise.all([
      stopPaymentWebhookWorker(),

      stopOrderReservationExpiryWorker(),
    ]);

    /*
    |--------------------------------------------------------------------------
    | Close HTTP Server
    |--------------------------------------------------------------------------
    */

    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);

            return;
          }

          resolve();
        });
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Disconnect MongoDB
    |--------------------------------------------------------------------------
    */

    await mongoose.disconnect();

    logger.info("Graceful shutdown completed");

    process.exit(0);
  } catch (error) {
    logger.error(
      {
        error,
      },
      "Graceful shutdown failed",
    );

    process.exit(1);
  }
};

/*
|--------------------------------------------------------------------------
| Process Signals
|--------------------------------------------------------------------------
*/

process.once(
  "SIGINT",

  () => {
    void shutdown("SIGINT");
  },
);

process.once(
  "SIGTERM",

  () => {
    void shutdown("SIGTERM");
  },
);

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

await startServer();
