import express from "express";
import request from "../helpers/api-request.helper.js";

import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/environment.js", () => ({
  default: {
    NODE_ENV: "production",
  },
}));

import apiRateLimiter from "../../src/middlewares/api-rate-limit.middleware.js";

describe("API rate-limit response", () => {
  it("allows 100 requests, then returns the standard 429 JSON response", async () => {
    const app = express();

    app.use((req, res, next) => {
      req.id = req.get("X-Test-Request-Id");
      next();
    });

    app.use("/api", apiRateLimiter);

    app.get("/api/probe", (req, res) => {
      res.status(200).json({
        success: true,
        message: "Probe succeeded",
      });
    });

    // Makes unexpected middleware errors observable in the test.
    app.use((error, req, res, next) => {
      res.status(500).json({
        success: false,
        errorCode: "UNEXPECTED_TEST_ERROR",
      });
    });

    const agent = request.agent(app);

    for (let count = 0; count < 100; count += 1) {
      const response = await agent.get("/api/probe");

      expect(response.status).toBe(200);
    }

    const blockedResponse = await agent
      .get("/api/probe")
      .set("X-Test-Request-Id", "rate-limit-regression-001");

    expect(blockedResponse.status).toBe(429);

    expect(blockedResponse.headers["content-type"]).toMatch(
      /application\/json/,
    );

    expect(blockedResponse.body).toEqual({
      success: false,
      message: "Too many requests. Please try again later.",
      errorCode: "TOO_MANY_REQUESTS",
      requestId: "rate-limit-regression-001",
    });

    expect(Number(blockedResponse.headers["retry-after"])).toBeGreaterThan(0);

    // The response keeps its shape when a request ID is unavailable.
    const responseWithoutId = await agent.get("/api/probe");

    expect(responseWithoutId.status).toBe(429);

    expect(responseWithoutId.body).toEqual({
      success: false,
      message: "Too many requests. Please try again later.",
      errorCode: "TOO_MANY_REQUESTS",
      requestId: null,
    });
  });
});
