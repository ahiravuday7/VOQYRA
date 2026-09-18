import AppError from "../errors/app-error.js";

const SAFE_ERROR_TYPES = new Set([
  "Error",
  "AppError",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AggregateError",
  "MongoServerError",
  "MongoNetworkError",
  "MongoServerSelectionError",
  "MongoTransactionError",
  "MongooseError",
  "ValidationError",
  "CastError",
  "VersionError",
]);

const SAFE_SYSTEM_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ABORT_ERR",
]);

const serializeLogError = (error) => {
  try {
    if (error == null) {
      return null;
    }

    if (typeof error !== "object") {
      return {
        type: "NonErrorThrown",
      };
    }

    const result = {
      type: SAFE_ERROR_TYPES.has(error.name) ? error.name : "Error",
    };

    if (
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode <= 599
    ) {
      result.statusCode = error.statusCode;
    }

    if (Number.isSafeInteger(error.code) || SAFE_SYSTEM_CODES.has(error.code)) {
      result.code = error.code;
    }

    /*
     * AppError codes are assigned by application code.
     * Do not copy arbitrary provider errorCode fields.
     */
    if (
      error instanceof AppError &&
      typeof error.errorCode === "string" &&
      /^[A-Z][A-Z0-9_]{0,99}$/.test(error.errorCode)
    ) {
      result.errorCode = error.errorCode;
    }

    return result;
  } catch {
    // Logging must not fail because an error property cannot be read.
    return {
      type: "Error",
    };
  }
};

export default serializeLogError;
