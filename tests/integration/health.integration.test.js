import mongoose from "mongoose";
import request from "supertest";

import { describe, expect, it, vi } from "vitest";

import app from "../../src/app.js";

const REQUEST_ID = "health-regression-001";

describe("Health response contract", () => {
  it("returns a traceable, non-cacheable 200 response when connected", async () => {
    const response = await request(app)
      .get("/api/v1/health")
      .set("X-Request-ID", REQUEST_ID);

    expect(response.status).toBe(200);

    expect(response.headers["content-type"]).toMatch(/application\/json/);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe(REQUEST_ID);

    expect(response.body).toMatchObject({
      success: true,
      message: "Clothing Commerce API is healthy",
      requestId: REQUEST_ID,
      data: {
        database: "connected",
        uptimeInSeconds: expect.any(Number),
        timestamp: expect.any(String),
      },
    });

    expect(response.body).not.toHaveProperty("errorCode");

    expect(Number.isFinite(Date.parse(response.body.data.timestamp))).toBe(
      true,
    );
  });

  it.each([
    { state: 0, label: "disconnected" },
    { state: 2, label: "connecting" },
    { state: 3, label: "disconnecting" },
    { state: 99, label: "unknown" },
  ])(
    "returns a traceable 503 response when the state is $label",
    async ({ state, label }) => {
      // Override only the reported getter, without disconnecting MongoDB.
      const stateSpy = vi
        .spyOn(mongoose.connection, "readyState", "get")
        .mockReturnValue(state);

      try {
        const response = await request(app)
          .get("/api/v1/health")
          .set("X-Request-ID", REQUEST_ID);

        expect(response.status).toBe(503);

        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["x-request-id"]).toBe(REQUEST_ID);

        expect(response.body).toMatchObject({
          success: false,
          message: "Clothing Commerce API is unavailable",
          errorCode: "HEALTH_CHECK_FAILED",
          requestId: REQUEST_ID,
          data: {
            database: label,
            uptimeInSeconds: expect.any(Number),
            timestamp: expect.any(String),
          },
        });

        expect(response.body).not.toHaveProperty("stack");
      } finally {
        stateSpy.mockRestore();
      }
    },
  );
});
