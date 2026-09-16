import { createHmac } from "node:crypto";

import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app.js";
import env from "../../src/config/environment.js";

import apiRequest from "../helpers/api-request.helper.js";

const REQUEST_ID = "csrf-app-regression-001";
const REGISTRATION_PATH = "/api/v1/auth/register";
const WEBHOOK_PATH = "/api/v1/webhooks/payments/razorpay";

const expectCsrfRejected = (response) => {
  expect(response.status).toBe(403);

  expect(response.body).toMatchObject({
    success: false,
    message: "Request source could not be verified",
    errorCode: "CSRF_VALIDATION_FAILED",
    requestId: REQUEST_ID,
  });
};

const expectValidationReached = (response) => {
  expect(response.status).toBe(400);

  expect(response.body).toMatchObject({
    success: false,
    errorCode: "REQUEST_VALIDATION_FAILED",
  });
};

describe("CSRF protection in the actual app", () => {
  it.each(["post", "put", "patch", "delete"])(
    "rejects an unverifiable %s request",
    async (method) => {
      const response = await request(app)
        [method](REGISTRATION_PATH)
        .set("X-Request-ID", REQUEST_ID)
        .send({});

      expectCsrfRejected(response);
    },
  );

  it.each([
    { name: "customer", origin: env.CLIENT_URL },
    { name: "admin", origin: env.ADMIN_URL },
  ])(
    "allows the approved $name Origin to reach validation",
    async ({ origin }) => {
      const response = await request(app)
        .post(REGISTRATION_PATH)
        .set("Origin", origin)
        .send({});

      expectValidationReached(response);
    },
  );

  it("accepts an approved Referer when Origin is absent", async () => {
    const response = await request(app)
      .post(REGISTRATION_PATH)
      .set("Referer", new URL("/register", env.CLIENT_URL).href)
      .send({});

    expectValidationReached(response);
  });

  it("supports both shared test clients and explicit header removal", async () => {
    for (const client of [apiRequest(app), apiRequest.agent(app)]) {
      const allowed = await client.post(REGISTRATION_PATH).send({});

      expectValidationReached(allowed);

      const rejected = await client
        .post(REGISTRATION_PATH)
        .unset("X-CSRF-Protection")
        .set("X-Request-ID", REQUEST_ID)
        .send({});

      expectCsrfRejected(rejected);
    }
  });

  it("rejects an untrusted Referer despite the fallback header", async () => {
    const response = await request(app)
      .post(REGISTRATION_PATH)
      .set("Referer", "https://attacker.example/page")
      .set("X-CSRF-Protection", "1")
      .set("X-Request-ID", REQUEST_ID)
      .send({});

    expectCsrfRejected(response);
  });

  it("allows the fallback header in frontend preflight requests", async () => {
    const response = await request(app)
      .options(REGISTRATION_PATH)
      .set("Origin", env.CLIENT_URL)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-protection");

    expect(response.status).toBe(204);

    expect(response.headers["access-control-allow-origin"]).toBe(
      env.CLIENT_URL,
    );

    const allowedHeaders = String(
      response.headers["access-control-allow-headers"] ?? "",
    )
      .toLowerCase()
      .split(",")
      .map((value) => value.trim());

    expect(allowedHeaders).toContain("x-csrf-protection");
  });

  it("still requires authentication after the CSRF check passes", async () => {
    const response = await request(app)
      .post("/api/v1/cart/items")
      .set("X-CSRF-Protection", "1")
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");
  });

  it("accepts a correctly signed webhook without CSRF headers", async () => {
    // Whitespace makes this sensitive to changes in raw-body handling.
    const rawBody = JSON.stringify(
      { event: "csrf.test.unsupported-event" },
      null,
      2,
    );

    const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-event-id", "csrf-signed-webhook-test")
      .set("x-razorpay-signature", signature)
      .send(rawBody);

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        action: "ignore",
        accepted: false,
      },
    });
  });

  it("still rejects an unsigned webhook", async () => {
    const response = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-event-id", "csrf-unsigned-webhook-test")
      .send('{"event":"csrf.test.unsupported-event"}');

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("RAZORPAY_WEBHOOK_SIGNATURE_REQUIRED");
  });
});
