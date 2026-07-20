import { rateLimit } from "express-rate-limit";

/*
| Login Rate Limiter
*/

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  /*
   * Maximum failed or incomplete login attempts
   * from one IP within 15 minutes.
   */
  limit: 10,

  standardHeaders: true,
  legacyHeaders: false,

  /*
   * Successful login responses are not counted.
   */
  skipSuccessfulRequests: true,

  message: {
    success: false,

    message: "Too many login attempts. Please try again later.",

    errorCode: "TOO_MANY_LOGIN_ATTEMPTS",
  },
});

export default loginRateLimiter;
