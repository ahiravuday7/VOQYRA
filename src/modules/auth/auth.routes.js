import { Router } from "express";

import validateRequest from "../../middlewares/validate-request.middleware.js";

import { registerRequestSchema } from "./auth.validation.js";

import { register } from "./auth.controller.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Customer Registration
|--------------------------------------------------------------------------
*/

router.post("/register", validateRequest(registerRequestSchema), register);

export default router;
