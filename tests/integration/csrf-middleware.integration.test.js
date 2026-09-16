import express from "express";
import request from "supertest";

import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/environment.js", () => ({
  default: {
    NODE_ENV: "production",
    CLIENT_URL: "https://shop.example.test",
    ADMIN_URL: "https://admin.example.test",
  },
}));

vi.mock("../../src/config/logger.js", () => ({
  default: {
    error: vi.fn(),
  },
}));

import csrfProtection from "../../src/middlewares/csrf.middleware.js";
import errorMiddleware from "../../src/middlewares/error.middleware.js";

const REQUEST_ID = "csrf-regression-001";

const buildApp = () => {
  const app = express();

  const endpoint = vi.fn((req, res) => {
    res.status(204).end();
  });

  app.use((req, res, next) => {
    req.id = REQUEST_ID;
    next();
  });

  app.use(csrfProtection);

  app.all("/probe", endpoint);

  app.use(errorMiddleware);

  return { app, endpoint };
};

const cases = [
  {
    name: "approved customer Origin",
    headers: { Origin: "https://shop.example.test" },
    allowed: true,
  },
  {
    name: "approved admin Origin",
    headers: { Origin: "https://admin.example.test" },
    allowed: true,
  },
  {
    name: "unapproved Origin",
    headers: { Origin: "https://attacker.example" },
    allowed: false,
  },
  {
    name: "opaque Origin",
    headers: { Origin: "null" },
    allowed: false,
  },
  {
    name: "approved Referer without Origin",
    headers: {
      Referer: "https://shop.example.test/checkout?step=payment",
    },
    allowed: true,
  },
  {
    name: "lookalike Referer host",
    headers: {
      Referer: "https://shop.example.test.attacker.example/checkout",
    },
    allowed: false,
  },
  {
    name: "malformed Referer",
    headers: { Referer: "not-a-valid-url" },
    allowed: false,
  },
  {
    name: "missing source and protection headers",
    headers: {},
    allowed: false,
  },
  {
    name: "explicit protection header without source headers",
    headers: { "X-CSRF-Protection": "1" },
    allowed: true,
  },
  {
    name: "incorrect protection header",
    headers: { "X-CSRF-Protection": "0" },
    allowed: false,
  },
  {
    name: "unapproved Origin despite a protection header",
    headers: {
      Origin: "https://attacker.example",
      "X-CSRF-Protection": "1",
    },
    allowed: false,
  },
  {
    name: "unapproved Referer despite a protection header",
    headers: {
      Referer: "https://attacker.example/page",
      "X-CSRF-Protection": "1",
    },
    allowed: false,
  },
];

const expectRejected = (response, endpoint) => {
  expect(response.status).toBe(403);

  expect(response.body).toEqual({
    success: false,
    message: "Request source could not be verified",
    errorCode: "CSRF_VALIDATION_FAILED",
    requestId: REQUEST_ID,
  });

  expect(endpoint).not.toHaveBeenCalled();
};

describe("CSRF middleware contract", () => {
  it.each(cases)("handles $name", async ({ headers, allowed }) => {
    const { app, endpoint } = buildApp();

    const response = await request(app).post("/probe").set(headers);

    if (allowed) {
      expect(response.status).toBe(204);
      expect(endpoint).toHaveBeenCalledTimes(1);
    } else {
      expectRejected(response, endpoint);
    }
  });

  it.each(["get", "head", "options"])(
    "allows safe %s requests without source headers",
    async (method) => {
      const { app, endpoint } = buildApp();

      const response = await request(app)[method]("/probe");

      expect(response.status).toBe(204);
      expect(endpoint).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["put", "patch", "delete"])(
    "rejects an unverifiable %s request before its handler",
    async (method) => {
      const { app, endpoint } = buildApp();

      const response = await request(app)[method]("/probe");

      expectRejected(response, endpoint);
    },
  );
});
