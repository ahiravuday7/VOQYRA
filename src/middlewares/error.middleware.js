import logger from "../config/logger.js";
import env from "../config/environment.js";

// This function handles MongoDB duplicate key errors.
const handleDuplicateKeyError = (error) => {
  const duplicatedFields = [
    ...new Set([
      ...Object.keys(error.keyPattern ?? {}),
      ...Object.keys(error.keyValue ?? {}),
    ]),
  ];

  return {
    statusCode: 409,
    message: duplicatedFields.length
      ? `${duplicatedFields.join(", ")} already exists`
      : "A record with the same value already exists",
    errorCode: "DUPLICATE_RESOURCE",
    details: duplicatedFields.length
      ? {
          fields: duplicatedFields,
        }
      : null,
  };
};

// This function handles Mongoose schema validation failures.
const handleMongooseValidationError = (error) => {
  const errors = Object.values(error.errors ?? {}).map((validationError) => ({
    field: validationError?.path ?? null,
    message:
      validationError?.kind === "required"
        ? "This field is required"
        : "Invalid value for this field",
  }));

  return {
    statusCode: 400,
    message: "Validation failed",
    errorCode: "VALIDATION_ERROR",
    details: errors.length ? errors : null,
  };
};

// This handles Mongoose CastError errors.
const handleCastError = (error) => {
  const field = error.path ?? null;

  return {
    statusCode: 400,
    message: field ? `Invalid value for ${field}` : "Invalid identifier",
    errorCode: "INVALID_IDENTIFIER",
    details: field ? { field } : null,
  };
};

// This function converts different error types into one common structure.
const normalizeError = (error) => {
  if (error?.type === "entity.parse.failed") {
    return {
      statusCode: 400,
      message: "Request body contains invalid JSON",
      errorCode: "INVALID_JSON",
      details: null,
    };
  }

  if (error?.type === "entity.too.large") {
    return {
      statusCode: 413,
      message: "Request body exceeds the allowed size",
      errorCode: "REQUEST_BODY_TOO_LARGE",
      details: null,
    };
  }
  if (error?.code === 11000) {
    return handleDuplicateKeyError(error);
  }

  if (error?.name === "ValidationError") {
    return handleMongooseValidationError(error);
  }

  if (error?.name === "CastError") {
    return handleCastError(error);
  }

  return {
    statusCode: error.statusCode ?? 500,
    message: error.message ?? "An unexpected error occurred",
    errorCode: error.errorCode ?? "INTERNAL_SERVER_ERROR",
    details: error.details ?? null,
  };
};

//Express global error middleware
const errorMiddleware = (error, request, response, next) => {
  if (response.headersSent) {
    return next(error);
  }
  const normalizedError = normalizeError(error);

  const isProduction = env.NODE_ENV === "production";

  const shouldExposeError =
    normalizedError.statusCode < 500 || error.expose === true;

  const hideInternalDetails = isProduction && !shouldExposeError;

  const responseBody = {
    success: false,

    message: hideInternalDetails
      ? "An unexpected error occurred"
      : normalizedError.message,

    errorCode: hideInternalDetails
      ? "INTERNAL_SERVER_ERROR"
      : normalizedError.errorCode,

    requestId: request.id ?? null,
  };

  if (!hideInternalDetails && normalizedError.details != null) {
    responseBody.details = normalizedError.details;
  }

  if (!isProduction) {
    responseBody.stack = error.stack;
  }

  const activeLogger = request.log ?? logger;

  if (normalizedError.statusCode >= 500) {
    activeLogger.error(
      {
        err: error,
        errorCode: normalizedError.errorCode,
        statusCode: normalizedError.statusCode,
        method: request.method,
        path:
          request.originalUrl?.split("?")[0] ??
          request.url?.split("?")[0] ??
          "/",
      },
      "Unhandled request error",
    );
  }

  return response.status(normalizedError.statusCode).json(responseBody);
};

export default errorMiddleware;
