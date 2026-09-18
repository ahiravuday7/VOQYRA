import { describe, expect, it } from "vitest";

import request from "../helpers/api-request.helper.js";
import app from "../../src/app.js";

import User from "../../src/modules/users/user.model.js";
import RefreshSession from "../../src/modules/auth/refresh-session.model.js";

const AUTH_URL = "/api/v1/auth";

const PASSWORD = "SecurityTest@123";

const validRegistration = () => ({
  firstName: "Security",
  lastName: "Customer",
  email: "security-customer@example.com",
  password: PASSWORD,
  confirmPassword: PASSWORD,
});

const expectValidationFailure = (response) => {
  expect(response.status).toBe(400);

  expect(response.body).toMatchObject({
    success: false,
    errorCode: "REQUEST_VALIDATION_FAILED",
  });

  expect(response.headers["set-cookie"]).toBeUndefined();
};

describe("Auth input security", () => {
  it("registers a customer with server-controlled fields and a hashed password", async () => {
    const response = await request(app)
      .post(`${AUTH_URL}/register`)
      .send(validRegistration());

    expect(response.status).toBe(201);

    expect(response.body.data.user).toMatchObject({
      email: "security-customer@example.com",
      role: "customer",
      isEmailVerified: false,
    });

    for (const field of [
      "password",
      "confirmPassword",
      "passwordChangedAt",
      "deletedAt",
    ]) {
      expect(response.body.data.user).not.toHaveProperty(field);
    }

    const user = await User.findOne({
      email: "security-customer@example.com",
    }).select("+password +passwordChangedAt");

    expect(user).not.toBeNull();
    expect(user.role).toBe("customer");
    expect(user.status).toBe("active");
    expect(user.isEmailVerified).toBe(false);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordChangedAt).toBeNull();
    expect(user.deletedAt).toBeNull();

    expect(user.password).not.toBe(PASSWORD);
    expect(await user.comparePassword(PASSWORD)).toBe(true);

    expect(await User.countDocuments()).toBe(1);
    expect(await RefreshSession.countDocuments()).toBe(0);
  });

  it.each([
    ["role", { role: "admin" }],
    ["status", { status: "blocked" }],
    ["email verification", { isEmailVerified: true }],
    ["verification timestamp", { emailVerifiedAt: "2026-01-01T00:00:00.000Z" }],
    [
      "password-change timestamp",
      { passwordChangedAt: "2026-01-01T00:00:00.000Z" },
    ],
    ["deletion timestamp", { deletedAt: "2026-01-01T00:00:00.000Z" }],
    ["document ID", { _id: "507f1f77bcf86cd799439011" }],
    [
      "avatar storage reference",
      {
        avatar: {
          url: "https://example.com/image.jpg",
          publicId: "another-account/asset",
        },
      },
    ],
  ])(
    "rejects a client-supplied %s without creating an account",
    async (name, extraFields) => {
      const response = await request(app)
        .post(`${AUTH_URL}/register`)
        .send({
          ...validRegistration(),
          ...extraFields,
        });

      expectValidationFailure(response);

      expect(await User.countDocuments()).toBe(0);
      expect(await RefreshSession.countDocuments()).toBe(0);
    },
  );

  it.each([
    ["email operator", { email: { $ne: null } }],
    [
      "password operator",
      {
        password: { $ne: null },
        confirmPassword: { $ne: null },
      },
    ],
    ["phone operator", { phone: { $regex: ".*" } }],
    ["update operator", { $set: { role: "admin" } }],
    ["query operator", { $where: "return true" }],
  ])("rejects registration containing a %s", async (name, overrides) => {
    const response = await request(app)
      .post(`${AUTH_URL}/register`)
      .send({
        ...validRegistration(),
        ...overrides,
      });

    expectValidationFailure(response);

    expect(await User.countDocuments()).toBe(0);
    expect(await RefreshSession.countDocuments()).toBe(0);
  });

  it.each([
    ["email", { email: { $ne: null } }],
    ["password", { password: { $ne: null } }],
  ])(
    "rejects a login %s operator without authenticating an existing account",
    async (field, overrides) => {
      const user = await User.create({
        firstName: "Existing",
        lastName: "Admin",
        email: "existing-admin@example.com",
        password: PASSWORD,
        role: "admin",
        status: "active",
      });

      const response = await request(app)
        .post(`${AUTH_URL}/login`)
        .send({
          email: user.email,
          password: PASSWORD,
          ...overrides,
        });

      expectValidationFailure(response);

      expect(await RefreshSession.countDocuments()).toBe(0);
      expect(await User.countDocuments()).toBe(1);

      const storedUser = await User.findById(user._id).lean();

      expect(storedUser.lastLoginAt).toBeNull();
      expect(storedUser.role).toBe("admin");
    },
  );
});
