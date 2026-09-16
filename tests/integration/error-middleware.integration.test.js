import mongoose from "mongoose";
import express from "express";
import request from "supertest";
import env from "../../src/config/environment.js";
import logger from "../../src/config/logger.js";

import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/environment.js", () => ({
  default: {
    NODE_ENV: "production",
  },
}));

vi.mock("../../src/config/logger.js", () => ({
  default: {
    error: vi.fn(),
  },
}));

import errorMiddleware from "../../src/middlewares/error.middleware.js";
import AppError from "../../src/shared/errors/app-error.js";

const REQUEST_ID = "error-middleware-regression-001";

const buildApp = () => {
  const app = express();

  app.use((req, res, next) => {
    req.id = REQUEST_ID;
    next();
  });

  const sendSuccess = (req, res) => {
    res.status(200).json({
      success: true,
      message: "Request accepted",
    });
  };

  app.post("/json", express.json({ limit: "1kb" }), sendSuccess);

  app.post(
    "/form",
    express.urlencoded({
      extended: true,
      limit: "1kb",
    }),
    sendSuccess,
  );

  app.post(
    "/raw",
    express.raw({
      type: "application/octet-stream",
      limit: "1kb",
    }),
    sendSuccess,
  );

  app.get("/runtime-error", () => {
    throw new SyntaxError("internal-parser-implementation-marker");
  });

  app.get("/business-error", () => {
    throw new AppError("Requested resource was not found", 404, {
      errorCode: "RESOURCE_NOT_FOUND",
    });
  });

  app.get("/unexpected-details", () => {
    const error = new Error("internal-database-message-marker");

    error.statusCode = 500;
    error.errorCode = "INTERNAL_DATABASE_DRIVER_MARKER";
    error.details = {
      diagnostic: "private-diagnostic-marker",
    };

    throw error;
  });

  app.get("/operational-unavailable", () => {
    throw new AppError("Payment service is temporarily unavailable", 503, {
      errorCode: "PAYMENT_SERVICE_UNAVAILABLE",
      details: {
        retryable: true,
      },
    });
  });

  app.get("/database-duplicate", () => {
    const error = new Error(
      "E11000 duplicate value private-email-marker@example.test",
    );

    error.code = 11000;
    error.keyPattern = { email: 1 };
    error.keyValue = {
      email: "private-email-marker@example.test",
    };

    throw error;
  });

  app.get("/database-duplicate-pattern-only", () => {
    const error = new Error("Internal unique-index failure");

    error.code = 11000;
    error.keyPattern = {
      customer: 1,
      "checkoutIdempotency.key": 1,
    };

    throw error;
  });

  app.get("/database-cast", () => {
    throw new mongoose.Error.CastError(
      "ObjectId",
      "private-cast-value-marker",
      "product",
    );
  });

  app.get("/database-validation", () => {
    const error = new mongoose.Error.ValidationError();

    error.addError(
      "email",
      new mongoose.Error.ValidatorError({
        path: "email",
        type: "user defined",
        value: "private-validator-value-marker",
        message: "Internal validator rejected private-validator-value-marker",
        reason: new Error("private-validator-reason-marker"),
      }),
    );

    error.addError(
      "product",
      new mongoose.Error.CastError(
        "ObjectId",
        "private-nested-cast-marker",
        "product",
      ),
    );

    error.addError(
      "name",
      new mongoose.Error.ValidatorError({
        path: "name",
        type: "required",
        message: "private-required-message-marker",
      }),
    );

    throw error;
  });

  app.use(errorMiddleware);

  return app;
};

describe("Global error middleware", () => {
  it("accepts a valid JSON body within the limit", async () => {
    const response = await request(buildApp())
      .post("/json")
      .send({ quantity: 1 });

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      success: true,
      message: "Request accepted",
    });
  });

  it("returns a safe 400 response for malformed JSON", async () => {
    const response = await request(buildApp())
      .post("/json")
      .set("Content-Type", "application/json")
      .send('{"privateValue":"parser-body-marker",}');

    expect(response.status).toBe(400);

    expect(response.headers["content-type"]).toMatch(/application\/json/);

    expect(response.body).toEqual({
      success: false,
      message: "Request body contains invalid JSON",
      errorCode: "INVALID_JSON",
      requestId: REQUEST_ID,
    });

    expect(response.text).not.toContain("parser-body-marker");
    expect(response.body).not.toHaveProperty("stack");
    expect(response.body).not.toHaveProperty("details");
  });

  it.each([
    {
      label: "JSON",
      path: "/json",
      contentType: "application/json",
      body: JSON.stringify({ value: "x".repeat(2048) }),
    },
    {
      label: "URL-encoded",
      path: "/form",
      contentType: "application/x-www-form-urlencoded",
      body: `value=${"x".repeat(2048)}`,
    },
    {
      label: "raw",
      path: "/raw",
      contentType: "application/octet-stream",
      body: Buffer.alloc(2048, "x"),
    },
  ])(
    "returns 413 when a $label body exceeds the limit",
    async ({ path, contentType, body }) => {
      const response = await request(buildApp())
        .post(path)
        .set("Content-Type", contentType)
        .send(body);

      expect(response.status).toBe(413);

      expect(response.body).toEqual({
        success: false,
        message: "Request body exceeds the allowed size",
        errorCode: "REQUEST_BODY_TOO_LARGE",
        requestId: REQUEST_ID,
      });
    },
  );

  it("keeps an application SyntaxError as a server error", async () => {
    const response = await request(buildApp()).get("/runtime-error");

    expect(response.status).toBe(500);

    expect(response.body).toEqual({
      success: false,
      message: "An unexpected error occurred",
      errorCode: "INTERNAL_SERVER_ERROR",
      requestId: REQUEST_ID,
    });

    expect(response.text).not.toContain(
      "internal-parser-implementation-marker",
    );
  });

  it("preserves an existing operational error response", async () => {
    const response = await request(buildApp()).get("/business-error");

    expect(response.status).toBe(404);

    expect(response.body).toEqual({
      success: false,
      message: "Requested resource was not found",
      errorCode: "RESOURCE_NOT_FOUND",
      requestId: REQUEST_ID,
    });
  });

  it("forwards the original error when headers are already sent", () => {
    const error = new Error("Response already started");

    const req = {
      id: REQUEST_ID,
      log: {
        error: vi.fn(),
      },
    };

    const res = {
      headersSent: true,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    errorMiddleware(error, req, res, next);

    expect(next).toHaveBeenCalledExactlyOnceWith(error);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("hides unexpected production details but logs the original error", async () => {
    const response = await request(buildApp()).get("/unexpected-details");

    expect(response.status).toBe(500);

    expect(response.body).toEqual({
      success: false,
      message: "An unexpected error occurred",
      errorCode: "INTERNAL_SERVER_ERROR",
      requestId: REQUEST_ID,
    });

    expect(response.text).not.toContain("internal-database-message-marker");

    expect(response.text).not.toContain("INTERNAL_DATABASE_DRIVER_MARKER");

    expect(response.text).not.toContain("private-diagnostic-marker");

    expect(response.body).not.toHaveProperty("details");
    expect(response.body).not.toHaveProperty("stack");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: "internal-database-message-marker",
          errorCode: "INTERNAL_DATABASE_DRIVER_MARKER",
          details: {
            diagnostic: "private-diagnostic-marker",
          },
        }),
        statusCode: 500,
      }),
      "Unhandled request error",
    );
  });

  it("preserves intentional operational 503 details in production", async () => {
    const response = await request(buildApp()).get("/operational-unavailable");

    expect(response.status).toBe(503);

    expect(response.body).toEqual({
      success: false,
      message: "Payment service is temporarily unavailable",
      errorCode: "PAYMENT_SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
      details: {
        retryable: true,
      },
    });

    expect(response.body).not.toHaveProperty("stack");
  });

  it("retains debugging information outside production", async () => {
    const previousEnvironment = env.NODE_ENV;

    try {
      env.NODE_ENV = "development";

      const response = await request(buildApp()).get("/unexpected-details");

      expect(response.status).toBe(500);

      expect(response.body).toMatchObject({
        success: false,
        message: "internal-database-message-marker",
        errorCode: "INTERNAL_DATABASE_DRIVER_MARKER",
        requestId: REQUEST_ID,
        details: {
          diagnostic: "private-diagnostic-marker",
        },
      });

      expect(response.body.stack).toContain("internal-database-message-marker");
    } finally {
      env.NODE_ENV = previousEnvironment;
    }
  });

  it("returns duplicate field names without exposing their values", async () => {
    const response = await request(buildApp()).get("/database-duplicate");

    expect(response.status).toBe(409);

    expect(response.body).toEqual({
      success: false,
      message: "email already exists",
      errorCode: "DUPLICATE_RESOURCE",
      requestId: REQUEST_ID,
      details: {
        fields: ["email"],
      },
    });

    expect(response.text).not.toContain("private-email-marker@example.test");

    expect(response.text).not.toContain("E11000");
  });

  it("handles duplicate errors containing only a key pattern", async () => {
    const response = await request(buildApp()).get(
      "/database-duplicate-pattern-only",
    );

    expect(response.status).toBe(409);

    expect(response.body).toEqual({
      success: false,
      message: "customer, checkoutIdempotency.key already exists",
      errorCode: "DUPLICATE_RESOURCE",
      requestId: REQUEST_ID,
      details: {
        fields: ["customer", "checkoutIdempotency.key"],
      },
    });

    expect(response.text).not.toContain("Internal unique-index failure");
  });

  it("returns a cast-error field without exposing the rejected value", async () => {
    const response = await request(buildApp()).get("/database-cast");

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      success: false,
      message: "Invalid value for product",
      errorCode: "INVALID_IDENTIFIER",
      requestId: REQUEST_ID,
      details: {
        field: "product",
      },
    });

    expect(response.text).not.toContain("private-cast-value-marker");
  });

  it("sanitizes validator messages and nested cast errors", async () => {
    const response = await request(buildApp()).get("/database-validation");

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      success: false,
      message: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      requestId: REQUEST_ID,
      details: [
        {
          field: "email",
          message: "Invalid value for this field",
        },
        {
          field: "product",
          message: "Invalid value for this field",
        },
        {
          field: "name",
          message: "This field is required",
        },
      ],
    });

    for (const marker of [
      "private-validator-value-marker",
      "private-validator-reason-marker",
      "private-nested-cast-marker",
      "private-required-message-marker",
    ]) {
      expect(response.text).not.toContain(marker);
    }

    expect(response.body).not.toHaveProperty("stack");
  });
});
