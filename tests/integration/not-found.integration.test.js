import request from "../helpers/api-request.helper.js";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

const REQUEST_ID = "not-found-regression-001";

describe("Unmatched route response contract", () => {
  it.each(["get", "post"])(
    "returns a safe 404 response for an unmatched %s request",
    async (method) => {
      const response = await request(app)
        [method]("/api/v1/__missing_route_marker__")
        .query({ token: "private-query-marker" })
        .set("X-Request-ID", REQUEST_ID);

      expect(response.status).toBe(404);

      expect(response.headers["content-type"]).toMatch(/application\/json/);

      expect(response.headers["x-request-id"]).toBe(REQUEST_ID);

      expect(response.body).toMatchObject({
        success: false,
        message: "Requested route was not found",
        errorCode: "ROUTE_NOT_FOUND",
        requestId: REQUEST_ID,
      });

      expect(response.text).not.toContain("private-query-marker");
      expect(response.text).not.toContain("__missing_route_marker__");
      expect(response.body).not.toHaveProperty("data");
      expect(response.body).not.toHaveProperty("details");
    },
  );

  it("generates a matching response header and body request ID", async () => {
    const response = await request(app).get("/api/v1/__missing_route_marker__");

    expect(response.status).toBe(404);

    const requestId = response.headers["x-request-id"];

    expect(requestId).toEqual(expect.any(String));
    expect(requestId.length).toBeGreaterThan(0);
    expect(response.body.requestId).toBe(requestId);
    expect(response.body.errorCode).toBe("ROUTE_NOT_FOUND");
  });
});
