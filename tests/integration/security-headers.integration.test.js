import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import app from "../../src/app.js";
import env from "../../src/config/environment.js";

const expectSecurityHeaders = (response) => {
  const headers = response.headers;

  expect(headers["x-powered-by"]).toBeUndefined();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");

  const hsts = String(headers["strict-transport-security"] ?? "");

  expect(hsts).toMatch(/(?:^|;\s*)max-age=31536000(?:;|$)/);
  expect(hsts).toMatch(/(?:^|;\s*)includeSubDomains(?:;|$)/);

  /*
   * Check individual CSP directives without depending
   * on their order in the header.
   */
  const cspDirectives = String(headers["content-security-policy"] ?? "")
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);

  expect(cspDirectives).toEqual(
    expect.arrayContaining([
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "script-src 'self'",
      "script-src-attr 'none'",
    ]),
  );

  expect(headers["x-request-id"]).toEqual(expect.any(String));
};

describe("Application security headers", () => {
  it("includes security headers on a successful API response", async () => {
    const response = await request(app).get("/api/v1/health").expect(200);

    expect(response.body.success).toBe(true);
    expectSecurityHeaders(response);
  });

  it("includes security headers on an authentication rejection", async () => {
    const response = await request(app).get("/api/v1/cart").expect(401);

    expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");
    expectSecurityHeaders(response);
  });

  it("includes security headers on an unknown route", async () => {
    const response = await request(app)
      .get("/api/v1/security-headers-missing-route")
      .expect(404);

    expect(response.body.errorCode).toBe("ROUTE_NOT_FOUND");
    expectSecurityHeaders(response);
  });

  it("includes security headers when CORS rejects the origin", async () => {
    const response = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://untrusted-security-test.example")
      .expect(403);

    expect(response.body.errorCode).toBe("CORS_ORIGIN_FORBIDDEN");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();

    expectSecurityHeaders(response);
  });

  it("includes security headers when CSRF protection rejects a request", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({})
      .expect(403);

    expect(response.body.errorCode).toBe("CSRF_VALIDATION_FAILED");
    expectSecurityHeaders(response);
  });

  it("includes security headers when JSON parsing fails", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("X-CSRF-Protection", "1")
      .set("Content-Type", "application/json")
      .send('{"email":')
      .expect(400);

    expect(response.body.errorCode).toBe("INVALID_JSON");
    expectSecurityHeaders(response);
  });

  it("includes security headers on an allowed CORS preflight", async () => {
    const response = await request(app)
      .options("/api/v1/orders")
      .set("Origin", env.CLIENT_URL)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-protection")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe(
      env.CLIENT_URL,
    );

    expect(response.headers["access-control-allow-credentials"]).toBe("true");

    expectSecurityHeaders(response);
  });

  it("includes security headers on an unavailable health response", async () => {
    /*
     * Override the reported state without disconnecting
     * the shared test database.
     */
    const stateSpy = vi
      .spyOn(mongoose.connection, "readyState", "get")
      .mockReturnValue(0);

    try {
      const response = await request(app).get("/api/v1/health").expect(503);

      expect(response.body.errorCode).toBe("HEALTH_CHECK_FAILED");
      expectSecurityHeaders(response);
    } finally {
      stateSpy.mockRestore();
    }
  });
});
