import request from "../helpers/api-request.helper.js";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";
import env from "../../src/config/environment.js";

const REQUEST_ID = "cors-regression-001";
const REJECTED_ORIGIN = "https://untrusted-origin.example";

const frontendOrigins = [
  {
    name: "customer frontend",
    origin: env.CLIENT_URL,
  },
  {
    name: "admin frontend",
    origin: env.ADMIN_URL,
  },
];

const headerValues = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

describe("CORS response contract", () => {
  it.each(frontendOrigins)(
    "allows checkout preflight headers from the $name",
    async ({ origin }) => {
      const response = await request(app)
        .options("/api/v1/orders")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set(
          "Access-Control-Request-Headers",
          "content-type, authorization, idempotency-key, x-request-id",
        );

      expect(response.status).toBe(204);

      expect(response.headers["access-control-allow-origin"]).toBe(origin);

      expect(response.headers["access-control-allow-credentials"]).toBe("true");

      expect(
        headerValues(response.headers["access-control-allow-methods"]),
      ).toContain("post");

      expect(
        headerValues(response.headers["access-control-allow-headers"]),
      ).toEqual(
        expect.arrayContaining([
          "content-type",
          "authorization",
          "idempotency-key",
          "x-request-id",
        ]),
      );

      expect(headerValues(response.headers.vary)).toContain("origin");
    },
  );

  it.each(frontendOrigins)(
    "exposes the response request ID to the $name",
    async ({ origin }) => {
      const response = await request(app)
        .get("/api/v1/products")
        .set("Origin", origin)
        .set("X-Request-ID", REQUEST_ID);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(response.headers["access-control-allow-origin"]).toBe(origin);

      expect(response.headers["access-control-allow-credentials"]).toBe("true");

      expect(response.headers["x-request-id"]).toBe(REQUEST_ID);

      expect(
        headerValues(response.headers["access-control-expose-headers"]),
      ).toContain("x-request-id");
    },
  );

  it.each(["get", "options"])(
    "rejects an unapproved origin on a %s request",
    async (method) => {
      const pendingRequest = request(app)
        [method]("/api/v1/products")
        .set("Origin", REJECTED_ORIGIN)
        .set("X-Request-ID", REQUEST_ID);

      if (method === "options") {
        pendingRequest
          .set("Access-Control-Request-Method", "GET")
          .set("Access-Control-Request-Headers", "x-request-id");
      }

      const response = await pendingRequest;

      expect(response.status).toBe(403);

      expect(response.body).toMatchObject({
        success: false,
        message: "Request origin is not allowed",
        errorCode: "CORS_ORIGIN_FORBIDDEN",
        requestId: REQUEST_ID,
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();

      expect(response.body).not.toHaveProperty("data");
    },
  );

  it("allows a public request without an Origin header", async () => {
    const response = await request(app).get("/api/v1/products");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
