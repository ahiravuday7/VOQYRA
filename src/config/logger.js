import pino from "pino";

import env from "./environment.js";

/*
|--------------------------------------------------------------------------
| Development Log Transport
|--------------------------------------------------------------------------
|
| Development:
|   Human-readable, formatted logs.
|
| Production:
|   Structured JSON logs.
|
*/

const transport =
  env.NODE_ENV === "development"
    ? pino.transport({
        target: "pino-pretty",

        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
        },
      })
    : undefined;

/*
|--------------------------------------------------------------------------
| Application Logger
|--------------------------------------------------------------------------
*/

const logger = pino(
  {
    level: env.NODE_ENV === "production" ? "info" : "debug",

    base: {
      service: "clothing-commerce-api",
      environment: env.NODE_ENV,
    },

    /*
    |--------------------------------------------------------------------------
    | Sensitive Data Redaction
    |--------------------------------------------------------------------------
    */

    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
      ],

      censor: "[REDACTED]",
    },
  },

  transport,
);

export default logger;
