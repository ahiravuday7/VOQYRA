import env from "../config/environment.js";

import AppError from "../shared/errors/app-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const allowedOrigins = new Set([env.CLIENT_URL, env.ADMIN_URL]);

const rejectRequest = (next) =>
  next(
    new AppError("Request source could not be verified", 403, {
      errorCode: "CSRF_VALIDATION_FAILED",
    }),
  );

const csrfProtection = (request, response, next) => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return next();
  }

  const origin = request.get("Origin");

  // An explicit untrusted Origin cannot use another fallback.
  if (origin !== undefined) {
    return allowedOrigins.has(origin) ? next() : rejectRequest(next);
  }

  const referer = request.get("Referer");

  if (referer !== undefined) {
    let source;

    try {
      source = new URL(referer);
    } catch {
      return rejectRequest(next);
    }

    const validProtocol =
      source.protocol === "http:" || source.protocol === "https:";

    if (
      !validProtocol ||
      source.username ||
      source.password ||
      !allowedOrigins.has(source.origin)
    ) {
      return rejectRequest(next);
    }

    return next();
  }

  // Explicit fallback for clients that send neither source header.
  if (request.get("X-CSRF-Protection") === "1") {
    return next();
  }

  return rejectRequest(next);
};

export default csrfProtection;
