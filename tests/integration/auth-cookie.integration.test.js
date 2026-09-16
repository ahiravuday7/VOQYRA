import express from "express";
import request from "../helpers/api-request.helper.js";

import { describe, expect, it, vi } from "vitest";

const cookieEnvironment = vi.hoisted(() => ({
  NODE_ENV: "test",
  AUTH_COOKIE_SAME_SITE: "lax",
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
}));

vi.mock("../../src/config/environment.js", () => ({
  default: cookieEnvironment,
}));

const cases = [
  {
    environment: "production",
    sameSite: "lax",
    secure: true,
  },
  {
    environment: "production",
    sameSite: "strict",
    secure: true,
  },
  {
    environment: "production",
    sameSite: "none",
    secure: true,
  },
  {
    environment: "development",
    sameSite: "lax",
    secure: false,
  },
  {
    environment: "development",
    sameSite: "none",
    secure: true,
  },
];

const cookieSpecs = [
  {
    name: "cc_access_token",
    value: "test-access-token",
    path: "/api",
    maxAgeSeconds: 900,
  },
  {
    name: "cc_refresh_token",
    value: "test-refresh-token",
    path: "/api/v1/auth",
    maxAgeSeconds: 604800,
  },
];

const findCookie = (response, name) => {
  const headers = response.headers["set-cookie"] ?? [];

  expect(headers).toHaveLength(2);

  const header = headers.find((value) => value.startsWith(`${name}=`));

  expect(header, `Missing cookie: ${name}`).toBeDefined();

  return header;
};

const expectCookieAttributes = (header, { path, sameSite, secure }) => {
  expect(header).toMatch(/;\s*HttpOnly(?:;|$)/i);

  expect(header.split(";").map((part) => part.trim())).toContain(
    `Path=${path}`,
  );

  expect(header.toLowerCase()).toContain(`samesite=${sameSite}`);

  expect(/;\s*Secure(?:;|$)/i.test(header)).toBe(secure);

  // Cookies remain scoped to the host that issued them.
  expect(header).not.toMatch(/;\s*Domain=/i);
};

describe("Authentication cookie headers", () => {
  it.each(cases)(
    "sets and clears cookies correctly in $environment with SameSite=$sameSite",
    async ({ environment, sameSite, secure }) => {
      cookieEnvironment.NODE_ENV = environment;
      cookieEnvironment.AUTH_COOKIE_SAME_SITE = sameSite;

      // Cookie options are calculated when the module is imported.
      vi.resetModules();

      const { setAuthCookies, clearAuthCookies } =
        await import("../../src/modules/auth/auth-cookie.service.js");

      const app = express();

      app.post("/set", (req, res) => {
        setAuthCookies(res, {
          accessToken: "test-access-token",
          refreshToken: "test-refresh-token",
        });

        res.status(200).json({ success: true });
      });

      app.post("/clear", (req, res) => {
        clearAuthCookies(res);

        res.status(200).json({ success: true });
      });

      const setResponse = await request(app).post("/set");

      expect(setResponse.status).toBe(200);

      const clearResponse = await request(app).post("/clear");

      expect(clearResponse.status).toBe(200);

      for (const spec of cookieSpecs) {
        const setHeader = findCookie(setResponse, spec.name);

        expect(setHeader.startsWith(`${spec.name}=${spec.value};`)).toBe(true);

        expectCookieAttributes(setHeader, {
          path: spec.path,
          sameSite,
          secure,
        });

        expect(setHeader.split(";").map((part) => part.trim())).toContain(
          `Max-Age=${spec.maxAgeSeconds}`,
        );

        const clearHeader = findCookie(clearResponse, spec.name);

        expect(clearHeader.startsWith(`${spec.name}=;`)).toBe(true);

        expectCookieAttributes(clearHeader, {
          path: spec.path,
          sameSite,
          secure,
        });

        const expiryMatch = clearHeader.match(/;\s*Expires=([^;]+)/i);

        expect(expiryMatch).not.toBeNull();

        expect(Date.parse(expiryMatch[1])).toBeLessThan(Date.now());

        expect(clearHeader).not.toMatch(/;\s*Max-Age=/i);
      }

      expect(setResponse.body).toEqual({ success: true });
      expect(clearResponse.body).toEqual({ success: true });
    },
  );
});
