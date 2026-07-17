import { randomUUID } from "node:crypto";

import pinoHttp from "pino-http";

import logger from "../config/logger.js";

/*
|--------------------------------------------------------------------------
| Request ID
|--------------------------------------------------------------------------
*/

const REQUEST_ID_HEADER = "x-request-id";

const isValidRequestId = (value) => {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(value);
};

/*
|--------------------------------------------------------------------------
| HTTP Request Logger
|--------------------------------------------------------------------------
*/

const requestLoggerMiddleware = pinoHttp({
  logger,

  /*
   * Reuse a valid incoming request ID when one is supplied.
   * Otherwise, generate a new UUID.
   */
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
   * Select log severity from the HTTP result.
   */
  customLogLevel(request, response, error) {
    if (error || response.statusCode >= 500) {
      return "error";
    }

    if (response.statusCode >= 400) {
      return "warn";
    }

    return "info";
  },

  customSuccessMessage(request, response) {
    return `${request.method} ${request.url} completed`;
  },

  customErrorMessage(request, response) {
    return `${request.method} ${request.url} failed`;
  },
});

export default requestLoggerMiddleware;
