import { randomUUID } from "node:crypto";

import pinoHttp from "pino-http";

import logger from "../config/logger.js";

import serializeLogError from "../shared/utilities/serialize-log-error.utility.js";

const REQUEST_ID_HEADER = "x-request-id";

const isValidRequestId = (value) => {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(value);
};

const requestLoggerMiddleware = pinoHttp({
  logger,
  wrapSerializers: false,

  genReqId(request, response) {
    const incomingHeader = request.headers[REQUEST_ID_HEADER];

    const incomingRequestId = Array.isArray(incomingHeader)
      ? incomingHeader[0]
      : incomingHeader;

    const requestId = isValidRequestId(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

    response.setHeader("X-Request-ID", requestId);

    return requestId;
  },

  /*
   * Return only the HTTP fields needed for request tracing.
   * Do not spread the original serialized request or response.
   */
  serializers: {
    err: serializeLogError,
    error: serializeLogError,

    req(request) {
      return {
        id: request.id,
        method: request.method,
        url: request.url?.split("?")[0] ?? "/",
      };
    },

    res(response) {
      return {
        statusCode: response.statusCode,
      };
    },
  },

  customLogLevel(request, response, error) {
    if (error || response.statusCode >= 500) {
      return "error";
    }

    if (response.statusCode >= 400) {
      return "warn";
    }

    return "info";
  },

  /*
   * The sanitized path is already present in req.url.
   * Keep raw request URLs out of message strings.
   */
  customSuccessMessage(request) {
    return `${request.method} request completed`;
  },

  customErrorMessage(request) {
    return `${request.method} request failed`;
  },
});

export default requestLoggerMiddleware;
