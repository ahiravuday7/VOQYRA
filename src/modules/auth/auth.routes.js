import { Router } from "express";

import loginRateLimiter from "../../middlewares/login-rate-limit.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";
import authenticate from "../../middlewares/authenticate.middleware.js";

import {
  loginRequestSchema,
  registerRequestSchema,
  refreshRequestSchema,
} from "./auth.validation.js";

import { login, register, getCurrentUser, refresh } from "./auth.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer Registration
|--------------------------------------------------------------------------
*/

router.post(
  "/register",

  validateRequest(registerRequestSchema),

  register,
);

/*
|--------------------------------------------------------------------------
| User Login
|--------------------------------------------------------------------------
*/

router.post(
  "/login",

  loginRateLimiter,

  validateRequest(loginRequestSchema),

  login,
);

/*
|--------------------------------------------------------------------------
| Refresh Authentication
|--------------------------------------------------------------------------
*/

router.post(
  "/refresh",

  validateRequest(refreshRequestSchema),

  refresh,
);

/*
|--------------------------------------------------------------------------
| Current Authenticated User
|--------------------------------------------------------------------------
*/

router.get("/me", authenticate, getCurrentUser);

export default router;
