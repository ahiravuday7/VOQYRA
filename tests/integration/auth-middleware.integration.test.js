import { randomUUID } from "node:crypto";

import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "../helpers/api-request.helper.js";

import { describe, expect, it } from "vitest";

import env from "../../src/config/environment.js";

import authenticate from "../../src/middlewares/authenticate.middleware.js";
import authorizeRoles from "../../src/middlewares/authorize.middleware.js";
import errorMiddleware from "../../src/middlewares/error.middleware.js";

import User from "../../src/modules/users/user.model.js";

import { generateAccessToken } from "../../src/modules/auth/auth-token.service.js";

import {
  AUTH_COOKIE_NAMES,
  JWT_ALGORITHM,
  TOKEN_TYPES,
} from "../../src/shared/constants/auth.constants.js";

import {
  USER_ROLES,
  USER_STATUSES,
} from "../../src/shared/constants/user.constants.js";

const REQUEST_ID = "auth-middleware-regression-001";

const buildApp = () => {
  const app = express();

  app.use(cookieParser());

  app.use((req, res, next) => {
    req.id = REQUEST_ID;
    next();
  });

  app.get(
    "/admin-probe",
    authenticate,
    authorizeRoles(USER_ROLES.ADMIN),
    (req, res) => {
      res.status(200).json({
        success: true,
        message: "Access granted",
        data: {
          userId: String(req.user._id),
        },
      });
    },
  );

  app.use(errorMiddleware);

  return app;
};

const createUser = ({
  role = USER_ROLES.ADMIN,
  status = USER_STATUSES.ACTIVE,
} = {}) =>
  User.create({
    firstName: "Authentication",
    lastName: "Regression",
    email: `auth-contract-${randomUUID()}@example.com`,
    password: "Testing@123",
    role,
    status,
    isEmailVerified: true,
    emailVerifiedAt: new Date(),
  });

const getAdminProbe = (token) => {
  const pendingRequest = request(buildApp()).get("/admin-probe");

  if (token !== undefined) {
    pendingRequest.set(
      "Cookie",
      `${AUTH_COOKIE_NAMES.ACCESS_TOKEN}=${encodeURIComponent(token)}`,
    );
  }

  return pendingRequest;
};

const expectAuthError = (response, status, errorCode) => {
  expect(response.status).toBe(status);

  expect(response.headers["content-type"]).toMatch(/application\/json/);

  expect(response.body).toMatchObject({
    success: false,
    message: expect.any(String),
    errorCode,
    requestId: REQUEST_ID,
  });

  expect(response.body.message.length).toBeGreaterThan(0);
  expect(response.body).not.toHaveProperty("data");
  expect(response.body).not.toHaveProperty("user");
  expect(response.body).not.toHaveProperty("auth");
};

// Explicit timestamps avoid sleeps and expiry-boundary races.
const signTokenAt = (userId, issuedAt, expiresAt) =>
  jwt.sign(
    {
      tokenType: TOKEN_TYPES.ACCESS,
      iat: issuedAt,
      exp: expiresAt,
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      subject: String(userId),
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      jwtid: randomUUID(),
    },
  );

describe("Authentication and authorization response contract", () => {
  it("returns 401 when the access cookie is missing", async () => {
    const response = await getAdminProbe();

    expectAuthError(response, 401, "AUTHENTICATION_REQUIRED");
  });

  it("returns 401 for a malformed token", async () => {
    const response = await getAdminProbe("not-a-valid-jwt");

    expectAuthError(response, 401, "INVALID_TOKEN");
  });

  it("returns 401 for an expired signed token", async () => {
    const user = await createUser();
    const now = Math.floor(Date.now() / 1000);

    const token = signTokenAt(user._id, now - 120, now - 60);

    const response = await getAdminProbe(token);

    expectAuthError(response, 401, "TOKEN_EXPIRED");
  });

  it("returns 401 for a signed token with an invalid user identifier", async () => {
    const token = generateAccessToken("invalid-user-identifier");

    const response = await getAdminProbe(token);

    expectAuthError(response, 401, "INVALID_TOKEN_SUBJECT");
  });

  it("returns 401 when the token references a nonexistent user", async () => {
    const token = generateAccessToken(new mongoose.Types.ObjectId());

    const response = await getAdminProbe(token);

    expectAuthError(response, 401, "AUTHENTICATED_USER_NOT_FOUND");
  });

  it("returns 401 after the authenticated user is soft-deleted", async () => {
    const user = await createUser();
    const token = generateAccessToken(user._id);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          status: USER_STATUSES.DELETED,
          deletedAt: new Date(),
        },
      },
    );

    const response = await getAdminProbe(token);

    expectAuthError(response, 401, "AUTHENTICATED_USER_NOT_FOUND");
  });

  it("returns 401 when the token predates the password-change timestamp", async () => {
    const user = await createUser();
    const now = Math.floor(Date.now() / 1000);

    const token = signTokenAt(user._id, now - 120, now + 3600);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordChangedAt: new Date((now - 60) * 1000),
        },
      },
    );

    const response = await getAdminProbe(token);

    expectAuthError(response, 401, "ACCESS_TOKEN_INVALIDATED");
  });

  it.each([
    {
      status: USER_STATUSES.BLOCKED,
      errorCode: "ACCOUNT_BLOCKED",
    },
    {
      status: USER_STATUSES.INACTIVE,
      errorCode: "ACCOUNT_INACTIVE",
    },
  ])(
    "returns 403 for an authenticated $status account",
    async ({ status, errorCode }) => {
      const user = await createUser({ status });
      const token = generateAccessToken(user._id);

      const response = await getAdminProbe(token);

      expectAuthError(response, 403, errorCode);
    },
  );

  it("returns 403 when a customer requests an admin-only route", async () => {
    const user = await createUser({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await getAdminProbe(generateAccessToken(user._id));

    expectAuthError(response, 403, "ACCESS_FORBIDDEN");
  });

  it("allows an active admin through both middleware functions", async () => {
    const user = await createUser();

    const response = await getAdminProbe(generateAccessToken(user._id));

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      success: true,
      message: "Access granted",
      data: {
        userId: String(user._id),
      },
    });
  });

  it("uses the current database role after admin access is removed", async () => {
    const user = await createUser();
    const token = generateAccessToken(user._id);

    const beforeChange = await getAdminProbe(token);

    expect(beforeChange.status).toBe(200);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          role: USER_ROLES.CUSTOMER,
        },
      },
    );

    const afterChange = await getAdminProbe(token);

    expectAuthError(afterChange, 403, "ACCESS_FORBIDDEN");
  });
});
