import express from "express";
import mongoose from "mongoose";
import request from "../helpers/api-request.helper.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedLogs = vi.hoisted(() => ({
  lines: [],
}));

vi.mock("../../src/config/logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { Writable } = await import("node:stream");

  const destination = new Writable({
    write(chunk, encoding, callback) {
      capturedLogs.lines.push(chunk.toString());
      callback();
    },
  });

  return {
    ...actual,
    default: actual.createLogger(destination),
  };
});

import logger from "../../src/config/logger.js";
import AppError from "../../src/shared/errors/app-error.js";
import requestLoggerMiddleware from "../../src/middlewares/request-logger.middleware.js";
import errorMiddleware from "../../src/middlewares/error.middleware.js";

const readRecords = () => {
  return capturedLogs.lines
    .join("")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const readLogText = () => capturedLogs.lines.join("");

describe("Error logging security", () => {
  beforeEach(() => {
    capturedLogs.lines.length = 0;
  });

  it.each(["err", "error"])(
    "omits sensitive error content under %s",
    (field) => {
      const error = new Error("message-secret-marker", {
        cause: new Error("cause-secret-marker"),
      });

      error.code = "ECONNRESET";
      error.statusCode = 502;
      error.stack = "stack-secret-marker";
      error.config = {
        headers: {
          authorization: "authorization-secret-marker",
        },
      };
      error.response = {
        data: {
          token: "provider-token-secret-marker",
        },
      };
      error.details = {
        password: "details-password-secret-marker",
      };

      logger.error(
        {
          [field]: error,
          requestId: "error-security-001",
        },
        "Provider request failed",
      );

      const [record] = readRecords();

      expect(record[field]).toEqual({
        type: "Error",
        statusCode: 502,
        code: "ECONNRESET",
      });

      expect(record.requestId).toBe("error-security-001");
      expect(record.msg).toBe("Provider request failed");
      expect(readLogText()).not.toContain("secret-marker");

      // Serialization must not modify the original error.
      expect(error.message).toBe("message-secret-marker");
      expect(error.details.password).toBe("details-password-secret-marker");
    },
  );

  it("omits rejected values and nested Mongoose validation errors", () => {
    const error = new mongoose.Error.ValidationError();

    error.addError(
      "email",
      new mongoose.Error.ValidatorError({
        path: "email",
        value: "database-value-secret-marker",
        message: "database-message-secret-marker",
        reason: new Error("database-reason-secret-marker"),
      }),
    );

    logger.error({ err: error }, "Document validation failed");

    const [record] = readRecords();

    expect(record.err).toEqual({
      type: "ValidationError",
    });

    expect(readLogText()).not.toContain("secret-marker");
  });

  it("preserves application error codes without copying details", () => {
    const error = new AppError("application-message-secret-marker", 503, {
      errorCode: "PAYMENT_SERVICE_UNAVAILABLE",
      details: {
        providerMessage: "provider-detail-secret-marker",
      },
    });

    logger.error({ err: error }, "Payment operation failed");

    const [record] = readRecords();

    expect(record.err).toEqual({
      type: "AppError",
      statusCode: 503,
      errorCode: "PAYMENT_SERVICE_UNAVAILABLE",
    });

    expect(readLogText()).not.toContain("secret-marker");
  });

  it.each(["direct", "wrapped"])(
    "uses a safe fallback message for a %s error",
    (form) => {
      const error = new Error("implicit-message-secret-marker");

      if (form === "direct") {
        logger.error(error);
      } else {
        logger.error({ err: error });
      }

      const [record] = readRecords();

      expect(record.msg).toBe("Application error");
      expect(record.err).toEqual({
        type: "Error",
      });

      expect(readLogText()).not.toContain("secret-marker");
    },
  );

  it("protects errors logged by the HTTP error middleware", async () => {
    const app = express();

    app.use(requestLoggerMiddleware);

    app.get("/fail", () => {
      const error = new Error("http-message-secret-marker");

      error.response = {
        data: {
          token: "http-provider-secret-marker",
        },
      };

      throw error;
    });

    app.use(errorMiddleware);

    const response = await request(app)
      .get("/fail?token=http-query-secret-marker")
      .set("X-Request-ID", "http-error-security-001")
      .expect(500);

    expect(response.headers["x-request-id"]).toBe("http-error-security-001");

    const applicationError = readRecords().find(
      (record) => record.msg === "Unhandled request error",
    );

    expect(applicationError).toMatchObject({
      err: {
        type: "Error",
      },
      req: {
        id: "http-error-security-001",
        method: "GET",
        url: "/fail",
      },
      path: "/fail",
      statusCode: 500,
    });

    expect(applicationError.err).toEqual({
      type: "Error",
    });

    expect(readLogText()).not.toContain("secret-marker");
  });

  it("preserves worker context and numeric database codes", () => {
    const workerLogger = logger.child({
      worker: "reservation-expiry",
    });

    const error = new Error("duplicate-value-secret-marker");

    error.name = "MongoServerError";
    error.code = 11000;
    error.keyValue = {
      email: "duplicate-email-secret-marker",
    };

    workerLogger.error(
      {
        error,
        orderId: "order-reference-001",
      },
      "Reservation processing failed",
    );

    const [record] = readRecords();

    expect(record).toMatchObject({
      worker: "reservation-expiry",
      orderId: "order-reference-001",
      error: {
        type: "MongoServerError",
        code: 11000,
      },
    });

    expect(readLogText()).not.toContain("secret-marker");
  });

  it("handles unusual and circular error values safely", () => {
    const providerError = {
      name: "provider-name-secret-marker",
      code: "provider-code-secret-marker",
      errorCode: "provider-error-code-secret-marker",
      message: "provider-message-secret-marker",
    };

    providerError.cause = providerError;

    logger.error({ error: providerError }, "Provider operation failed");
    logger.error({ err: "thrown-string-secret-marker" }, "Task failed");

    const unreadableError = {};

    Object.defineProperty(unreadableError, "name", {
      get() {
        throw new Error("getter-secret-marker");
      },
    });

    expect(() => {
      logger.error({ err: unreadableError }, "Error inspection failed");
    }).not.toThrow();

    const records = readRecords();

    expect(records[0].error).toEqual({ type: "Error" });
    expect(records[1].err).toEqual({ type: "NonErrorThrown" });
    expect(records[2].err).toEqual({ type: "Error" });

    expect(readLogText()).not.toContain("secret-marker");
  });
});
