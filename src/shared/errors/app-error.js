class AppError extends Error {
  constructor(message, statusCode = 500, options = {}) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = options.errorCode ?? null;
    this.details = options.details ?? null;
    this.isOperational = true;

    this.expose = options.expose ?? statusCode < 500;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
