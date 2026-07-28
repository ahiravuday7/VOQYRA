import { rateLimit } from "express-rate-limit";
import env from "../config/environment.js";

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  // Maximum 100 requests from one IP in 15 minutes.
  limit: 100,

  standardHeaders: true,
  legacyHeaders: false,

  /*
  |--------------------------------------------------------------------------
  | Skip During Automated Tests
  |--------------------------------------------------------------------------
  |
  | Integration tests can make hundreds of requests
  | from the same local IP address.
  |--------------------------------------------------------------------------
  */
  skip: () => {
    return env.NODE_ENV === "test";
  },

  handler: (request, response, options) => {
    return response.status(options.statusCode).json({
      success: false,

      message: "Too many requests. Please try again later.",

      errorCode: "TOO_MANY_REQUESTS",

      requestId: request.id,
    });
  },
});

export default apiRateLimiter;
