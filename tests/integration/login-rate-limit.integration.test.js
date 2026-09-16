import express from "express";
import request from "../helpers/api-request.helper.js";

import { describe, expect, it, vi } from "vitest";

const REQUEST_ID = "login-rate-limit-regression-001";

const buildApp = async () => {
  // Give each test a fresh limiter and in-memory counter.
  vi.resetModules();

  const { default: loginRateLimiter } =
    await import("../../src/middlewares/login-rate-limit.middleware.js");

  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    req.id = req.get("X-Test-Request-ID");
    next();
  });

  const loginHandler = vi.fn((req, res) => {
    if (req.body.outcome === "success") {
      return res.status(200).json({
        success: true,
        message: "Test login succeeded",
      });
    }

    if (req.body.outcome === "failure") {
      return res.status(401).json({
        success: false,
        message: "Test credentials rejected",
      });
    }

    return res.status(400).json({
      success: false,
      message: "Test login input is incomplete",
    });
  });

  app.post("/login", loginRateLimiter, loginHandler);

  return { app, loginHandler };
};

const postLogin = (app, outcome, requestId = REQUEST_ID) => {
  const pendingRequest = request(app).post("/login");

  if (requestId !== null) {
    pendingRequest.set("X-Test-Request-ID", requestId);
  }

  return pendingRequest.send(outcome === undefined ? {} : { outcome });
};

const expectBlocked = (response, requestId = REQUEST_ID) => {
  expect(response.status).toBe(429);

  expect(response.headers["content-type"]).toMatch(/application\/json/);

  expect(response.body).toEqual({
    success: false,
    message: "Too many login attempts. Please try again later.",
    errorCode: "TOO_MANY_LOGIN_ATTEMPTS",
    requestId,
  });

  expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
};

describe("Login rate limiting", () => {
  it("blocks after 10 failed attempts and preserves the error response format", async () => {
    const { app, loginHandler } = await buildApp();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postLogin(app, "failure");

      expect(response.status).toBe(401);
    }

    expect(loginHandler).toHaveBeenCalledTimes(10);

    const blocked = await postLogin(app, "failure");

    expectBlocked(blocked);

    // A blocked request must not reach credential processing.
    expect(loginHandler).toHaveBeenCalledTimes(10);

    const blockedWithoutId = await postLogin(app, "failure", null);

    expectBlocked(blockedWithoutId, null);
    expect(loginHandler).toHaveBeenCalledTimes(10);
  });

  it("excludes successful responses without resetting earlier failures", async () => {
    const { app, loginHandler } = await buildApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postLogin(app, "failure");

      expect(response.status).toBe(401);
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await postLogin(app, "success");

      expect(response.status).toBe(200);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postLogin(app, "failure");

      expect(response.status).toBe(401);
    }

    expect(loginHandler).toHaveBeenCalledTimes(22);

    const blocked = await postLogin(app, "failure");

    expectBlocked(blocked);
    expect(loginHandler).toHaveBeenCalledTimes(22);
  });

  it("counts incomplete login requests toward the limit", async () => {
    const { app, loginHandler } = await buildApp();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postLogin(app, undefined);

      expect(response.status).toBe(400);
    }

    const blocked = await postLogin(app, undefined);

    expectBlocked(blocked);
    expect(loginHandler).toHaveBeenCalledTimes(10);
  });
});
