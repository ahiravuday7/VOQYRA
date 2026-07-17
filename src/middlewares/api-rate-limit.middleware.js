import { rateLimit } from "express-rate-limit";

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  // Maximum 100 requests from one IP in 15 minutes.
  limit: 100,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

export default apiRateLimiter;
