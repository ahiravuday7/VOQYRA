import request from "supertest";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

/*
|--------------------------------------------------------------------------
| Health API Integration Test
|--------------------------------------------------------------------------
*/

describe("GET /api/v1/health", () => {
  it("returns a successful JSON response", async () => {
    const response = await request(app)
      .get("/api/v1/health")
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body).toBeTypeOf("object");
  });
});
