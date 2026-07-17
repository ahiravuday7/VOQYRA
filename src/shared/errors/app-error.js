class AppError extends Error {
  constructor(message, statusCode = 500, options = {}) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = options.errorCode ?? null;
    this.details = options.details ?? null;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
