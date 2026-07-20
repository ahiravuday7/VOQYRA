import { Router } from "express";

import loginRateLimiter from "../../middlewares/login-rate-limit.middleware.js";
import validateRequest from "../../middlewares/validate-request.middleware.js";

import {
  loginRequestSchema,
  registerRequestSchema,
} from "./auth.validation.js";

import { login, register } from "./auth.controller.js";

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

export default router;
