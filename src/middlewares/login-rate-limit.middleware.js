import { rateLimit } from "express-rate-limit";

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  limit: 10,

  statusCode: 429,

  standardHeaders: true,
  legacyHeaders: false,

  skipSuccessfulRequests: true,

  handler: (request, response, next, options) => {
    return response.status(options.statusCode).json({
      success: false,
      message: "Too many login attempts. Please try again later.",
      errorCode: "TOO_MANY_LOGIN_ATTEMPTS",
      requestId: request.id ?? null,
    });
  },
});

export default loginRateLimiter;
