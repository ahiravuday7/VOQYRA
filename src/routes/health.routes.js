import { Router } from "express";
import mongoose from "mongoose";

import env from "../config/environment.js";

const router = Router();

const DATABASE_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

router.get("/", (request, response) => {
  const databaseStatus =
    DATABASE_STATES[mongoose.connection.readyState] ?? "unknown";

  const isHealthy = databaseStatus === "connected";

  const responseBody = {
    success: isHealthy,
    message: isHealthy
      ? "Clothing Commerce API is healthy"
      : "Clothing Commerce API is unavailable",
    requestId: request.id ?? null,
    data: {
      environment: env.NODE_ENV,
      database: databaseStatus,
      uptimeInSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  };

  if (!isHealthy) {
    responseBody.errorCode = "HEALTH_CHECK_FAILED";
  }

  response.set("Cache-Control", "no-store");

  return response.status(isHealthy ? 200 : 503).json(responseBody);
});

export default router;
