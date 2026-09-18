import pino from "pino";

import env from "./environment.js";
import serializeLogError from "../shared/utilities/serialize-log-error.utility.js";

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

const createLogger = (destination = transport) => {
  return pino(
    {
      level: env.NODE_ENV === "production" ? "info" : "debug",

      base: {
        service: "clothing-commerce-api",
        environment: env.NODE_ENV,
      },

      serializers: {
        err: serializeLogError,
        error: serializeLogError,
      },

      /*
       * Prevent an omitted log message from causing Pino to
       * use the original error.message as the log message.
       */
      hooks: {
        logMethod(args, method) {
          const firstArgument = args[0];

          const containsError =
            firstArgument !== null &&
            typeof firstArgument === "object" &&
            (firstArgument instanceof Error ||
              Object.hasOwn(firstArgument, "err") ||
              Object.hasOwn(firstArgument, "error"));

          if (containsError && args[1] === undefined) {
            return method.call(this, firstArgument, "Application error");
          }

          return method.apply(this, args);
        },
      },

      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
        ],
        censor: "[REDACTED]",
      },
    },
    destination,
  );
};

const logger = createLogger();

export { createLogger };
export default logger;
