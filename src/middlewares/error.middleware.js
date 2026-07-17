import logger from "../config/logger.js";
import env from "../config/environment.js";

// This function handles MongoDB duplicate key errors.
const handleDuplicateKeyError = (error) => {
  const duplicatedFields = Object.keys(error.keyValue ?? {});

  const duplicatedValues = Object.values(error.keyValue ?? {});

  return {
    statusCode: 409,
    message: duplicatedFields.length
      ? `${duplicatedFields.join(", ")} already exists`
      : "A record with the same value already exists",
    errorCode: "DUPLICATE_RESOURCE",
    details: duplicatedValues.length
      ? {
          fields: duplicatedFields,
          values: duplicatedValues,
        }
      : null,
  };
};

// This function handles Mongoose schema validation failures.
const handleMongooseValidationError = (error) => {
  const errors = Object.values(error.errors).map((validationError) => ({
    field: validationError.path,
    message: validationError.message,
  }));

  return {
    statusCode: 400,
    message: "Validation failed",
    errorCode: "VALIDATION_ERROR",
    details: errors,
  };
};

// This handles Mongoose CastError errors.
const handleCastError = (error) => {
  return {
    statusCode: 400,
    message: `Invalid value for ${error.path}`,
    errorCode: "INVALID_IDENTIFIER",
    details: {
      field: error.path,
      value: error.value,
    },
  };
};

// This function converts different error types into one common structure.
const normalizeError = (error) => {
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
  const normalizedError = normalizeError(error);

  const isProduction = env.NODE_ENV === "production";

  const isOperationalError =
    error.isOperational === true || normalizedError.statusCode < 500;

  const safeMessage =
    isProduction && !isOperationalError
      ? "An unexpected error occurred"
      : normalizedError.message;

  const responseBody = {
    success: false,
    message: safeMessage,
    errorCode: normalizedError.errorCode,
    requestId: request.id ?? null,
  };

  if (normalizedError.details) {
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
        path: request.originalUrl,
      },
      "Unhandled request error",
    );
  }

  return response.status(normalizedError.statusCode).json(responseBody);
};

export default errorMiddleware;
