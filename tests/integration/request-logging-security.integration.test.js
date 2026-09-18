import express from "express";
import request from "../helpers/api-request.helper.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedLogs = vi.hoisted(() => ({
  lines: [],
}));

vi.mock("../../src/config/logger.js", async () => {
  const { default: pino } = await import("pino");
  const { Writable } = await import("node:stream");

  const destination = new Writable({
    write(chunk, encoding, callback) {
      capturedLogs.lines.push(chunk.toString());
      callback();
    },
  });

  return {
    default: pino(
      {
        level: "trace",
        base: false,
      },
      destination,
    ),
  };
});

import requestLoggerMiddleware from "../../src/middlewares/request-logger.middleware.js";
import errorMiddleware from "../../src/middlewares/error.middleware.js";

const buildApp = () => {
  const app = express();

  app.use(requestLoggerMiddleware);
  app.use(express.json());

  app.get("/probe", (req, res) => {
    res.json({
      success: true,
      query: req.query,
    });
  });

  app.post("/probe", (req, res) => {
    res.json({ success: true });
  });

  app.get("/cookie", (req, res) => {
    res.cookie("accessToken", "response-cookie-secret-marker", {
      httpOnly: true,
    });

    res.json({ success: true });
  });

  app.get("/fail", () => {
    throw new Error("Synthetic logging test failure");
  });

  app.use(errorMiddleware);

  return app;
};

const readRecords = () => {
  return capturedLogs.lines
    .join("")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const readLogText = () => capturedLogs.lines.join("");

describe("HTTP request logging security", () => {
  beforeEach(() => {
    capturedLogs.lines.length = 0;
  });

  it("omits query values without changing what the route receives", async () => {
    const response = await request(buildApp())
      .get("/probe")
      .query({
        token: "query-token-secret-marker",
        email: "query-email-marker@example.test",
      })
      .expect(200);

    expect(response.body.query).toEqual({
      token: "query-token-secret-marker",
      email: "query-email-marker@example.test",
    });

    const completed = readRecords().find(
      (record) => record.msg === "GET request completed",
    );

    expect(completed).toMatchObject({
      req: {
        method: "GET",
        url: "/probe",
      },
      res: {
        statusCode: 200,
      },
      responseTime: expect.any(Number),
    });

    expect(readLogText()).not.toContain("query-token-secret-marker");
    expect(readLogText()).not.toContain("query-email-marker");
  });

  it("omits queries from both error logs and failed-request logs", async () => {
    await request(buildApp())
      .get("/fail")
      .query({ token: "failed-query-secret-marker" })
      .expect(500);

    const records = readRecords();

    const applicationError = records.find(
      (record) => record.msg === "Unhandled request error",
    );

    expect(applicationError).toMatchObject({
      path: "/fail",
      method: "GET",
      statusCode: 500,
      req: {
        url: "/fail",
      },
    });

    const failedRequest = records.find(
      (record) => record.msg === "GET request failed",
    );

    expect(failedRequest).toMatchObject({
      req: {
        url: "/fail",
      },
      res: {
        statusCode: 500,
      },
    });

    expect(readLogText()).not.toContain("failed-query-secret-marker");
  });

  it("omits request headers and body from automatic HTTP logs", async () => {
    await request(buildApp())
      .post("/probe")
      .set("Authorization", "Bearer authorization-secret-marker")
      .set("Cookie", "accessToken=request-cookie-secret-marker")
      .set("Referer", "https://example.test/reset?token=referer-secret-marker")
      .set("X-Private-Test", "custom-header-secret-marker")
      .send({
        password: "body-password-secret-marker",
        refreshToken: "body-refresh-secret-marker",
      })
      .expect(200);

    const completed = readRecords().find(
      (record) => record.msg === "POST request completed",
    );

    expect(completed.req).toEqual({
      id: expect.any(String),
      method: "POST",
      url: "/probe",
    });

    for (const marker of [
      "authorization-secret-marker",
      "request-cookie-secret-marker",
      "referer-secret-marker",
      "custom-header-secret-marker",
      "body-password-secret-marker",
      "body-refresh-secret-marker",
    ]) {
      expect(readLogText()).not.toContain(marker);
    }
  });

  it("omits response cookies while still sending them to the client", async () => {
    const response = await request(buildApp()).get("/cookie").expect(200);

    expect(response.headers["set-cookie"].join(";")).toContain(
      "response-cookie-secret-marker",
    );

    const completed = readRecords().find(
      (record) => record.msg === "GET request completed",
    );

    expect(completed.res).toEqual({
      statusCode: 200,
    });

    expect(readLogText()).not.toContain("response-cookie-secret-marker");
  });

  it("preserves request correlation IDs in responses and logs", async () => {
    const requestId = "logging-security-regression-001";

    const response = await request(buildApp())
      .get("/probe")
      .set("X-Request-ID", requestId)
      .expect(200);

    expect(response.headers["x-request-id"]).toBe(requestId);

    const completed = readRecords().find(
      (record) => record.msg === "GET request completed",
    );

    expect(completed.req.id).toBe(requestId);
  });
});
