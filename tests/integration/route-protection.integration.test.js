import { randomUUID } from "node:crypto";

import request from "../helpers/api-request.helper.js";

import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import User from "../../src/modules/users/user.model.js";

import { generateAccessToken } from "../../src/modules/auth/auth-token.service.js";

import { AUTH_COOKIE_NAMES } from "../../src/shared/constants/auth.constants.js";

import {
  USER_ROLES,
  USER_STATUSES,
} from "../../src/shared/constants/user.constants.js";

const REQUEST_ID = "route-protection-regression-001";
const ID = "507f1f77bcf86cd799439011";

const protectedGroups = [
  {
    name: "Admin categories",
    path: "/api/v1/admin/categories",
    role: USER_ROLES.ADMIN,
    writes: [["post", ""]],
  },
  {
    name: "Admin brands",
    path: "/api/v1/admin/brands",
    role: USER_ROLES.ADMIN,
    writes: [["post", ""]],
  },
  {
    name: "Admin size guides",
    path: "/api/v1/admin/size-guides",
    role: USER_ROLES.ADMIN,
    writes: [["post", ""]],
  },
  {
    name: "Admin collections",
    path: "/api/v1/admin/collections",
    role: USER_ROLES.ADMIN,
    writes: [["post", ""]],
  },
  {
    name: "Admin products",
    path: "/api/v1/admin/products",
    role: USER_ROLES.ADMIN,
    writes: [
      ["post", ""],
      ["post", `/${ID}/variants/${ID}/inventory/reserve`],
      ["post", `/${ID}/images`],
    ],
  },
  {
    name: "Admin orders",
    path: "/api/v1/admin/orders",
    role: USER_ROLES.ADMIN,
    writes: [
      ["patch", `/${ID}/status`],
      ["post", `/${ID}/refund`],
    ],
  },
  {
    name: "Admin returns",
    path: "/api/v1/admin/order-returns",
    role: USER_ROLES.ADMIN,
    writes: [
      ["post", `/${ID}/approve`],
      ["post", `/${ID}/refund`],
    ],
  },
  {
    name: "Admin replacements",
    path: "/api/v1/admin/order-return-replacements",
    role: USER_ROLES.ADMIN,
    writes: [
      ["post", `/${ID}/ship`],
      ["post", `/${ID}/cancel`],
    ],
  },
  {
    name: "Admin payment webhooks",
    path: "/api/v1/admin/payment-webhooks",
    role: USER_ROLES.ADMIN,
    writes: [["post", `/${ID}/requeue`]],
  },
  {
    name: "Admin payment reconciliations",
    path: "/api/v1/admin/payment-reconciliations",
    role: USER_ROLES.ADMIN,
    writes: [],
  },
  {
    name: "Customer cart",
    path: "/api/v1/cart",
    role: USER_ROLES.CUSTOMER,
    writes: [
      ["post", "/items"],
      ["delete", ""],
    ],
  },
  {
    name: "Customer wishlist",
    path: "/api/v1/wishlist",
    role: USER_ROLES.CUSTOMER,
    writes: [
      ["post", "/items"],
      ["delete", ""],
    ],
  },
  {
    name: "Customer recently viewed",
    path: "/api/v1/recently-viewed",
    role: USER_ROLES.CUSTOMER,
    writes: [["delete", ""]],
  },
  {
    name: "Customer orders",
    path: "/api/v1/orders",
    role: USER_ROLES.CUSTOMER,
    writes: [
      ["post", ""],
      ["post", `/${ID}/payments`],
      ["post", `/${ID}/cancel`],
    ],
  },
];

const publicLists = [
  "/api/v1/categories",
  "/api/v1/brands",
  "/api/v1/size-guides",
  "/api/v1/collections",
  "/api/v1/products",
];

const createAuthCookie = async (role) => {
  const user = await User.create({
    firstName: "Route",
    lastName: "Protection",
    email: `route-protection-${randomUUID()}@example.com`,
    password: "Testing@123",
    role,
    status: USER_STATUSES.ACTIVE,
    isEmailVerified: true,
    emailVerifiedAt: new Date(),
  });

  const token = generateAccessToken(user._id);

  return `${AUTH_COOKIE_NAMES.ACCESS_TOKEN}=${encodeURIComponent(token)}`;
};

const sendRequest = (method, path, cookie) => {
  const pendingRequest = request(app)
    [method](path)
    .set("X-Request-ID", REQUEST_ID);

  if (cookie) {
    pendingRequest.set("Cookie", cookie);
  }

  if (["post", "put", "patch"].includes(method)) {
    pendingRequest.send({});
  }

  return pendingRequest;
};

const expectDenied = (response, status, errorCode, label) => {
  expect(response.status, label).toBe(status);

  expect(response.body, label).toMatchObject({
    success: false,
    message: expect.any(String),
    errorCode,
    requestId: REQUEST_ID,
  });

  expect(response.body, label).not.toHaveProperty("data");

  expect(response.headers["x-request-id"], label).toBe(REQUEST_ID);
};

describe("Mounted route protection", () => {
  it.each(protectedGroups)(
    "$name enforces its authentication and role boundary",
    async ({ path, role, writes }) => {
      const wrongRole =
        role === USER_ROLES.ADMIN ? USER_ROLES.CUSTOMER : USER_ROLES.ADMIN;

      const allowedCookie = await createAuthCookie(role);
      const forbiddenCookie = await createAuthCookie(wrongRole);

      const anonymous = await sendRequest("get", path);

      expectDenied(
        anonymous,
        401,
        "AUTHENTICATION_REQUIRED",
        `Anonymous GET ${path}`,
      );

      const forbidden = await sendRequest("get", path, forbiddenCookie);

      expectDenied(
        forbidden,
        403,
        "ACCESS_FORBIDDEN",
        `${wrongRole} GET ${path}`,
      );

      // Confirms the list endpoint is actually mounted and usable.
      const allowed = await sendRequest("get", path, allowedCookie);

      expect(allowed.status, `${role} GET ${path}`).toBe(200);
      expect(allowed.body.success, `${role} GET ${path}`).toBe(true);

      for (const [method, suffix] of writes) {
        const writePath = `${path}${suffix}`;
        const label = `${method.toUpperCase()} ${writePath}`;

        const anonymousWrite = await sendRequest(method, writePath);

        expectDenied(
          anonymousWrite,
          401,
          "AUTHENTICATION_REQUIRED",
          `Anonymous ${label}`,
        );

        const forbiddenWrite = await sendRequest(
          method,
          writePath,
          forbiddenCookie,
        );

        expectDenied(
          forbiddenWrite,
          403,
          "ACCESS_FORBIDDEN",
          `${wrongRole} ${label}`,
        );
      }
    },
  );

  it.each(publicLists)(
    "keeps GET %s accessible without authentication",
    async (path) => {
      const response = await sendRequest("get", path);

      expect(response.status, path).toBe(200);
      expect(response.body.success, path).toBe(true);
    },
  );
});
