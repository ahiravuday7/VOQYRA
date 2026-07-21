import {
  loginUser,
  registerCustomer,
  refreshAuthentication,
  logoutAuthentication,
} from "./auth.service.js";

import { setAuthCookies, clearAuthCookies } from "./auth-cookie.service.js";

import { toPublicUser } from "../users/user.mapper.js";

import { AUTH_COOKIE_NAMES } from "../../shared/constants/auth.constants.js";

/*
|--------------------------------------------------------------------------
| Register Customer
|--------------------------------------------------------------------------
*/

export const register = async (request, response) => {
  const registrationData = request.validated.body;

  const user = await registerCustomer(registrationData);

  return response.status(201).json({
    success: true,

    message: "Account created successfully",

    data: {
      user: toPublicUser(user),
    },
  });
};

/*
| Login User
*/

export const login = async (request, response) => {
  const credentials = request.validated.body;

  const { user, tokens } = await loginUser(credentials, {
    ipAddress: request.ip,

    userAgent: request.headers["user-agent"],
  });

  setAuthCookies(response, tokens);

  return response.status(200).json({
    success: true,

    message: "Login successful",

    data: {
      user: toPublicUser(user),
    },
  });
};

/*
| Get Current Authenticated User
*/

export const getCurrentUser = async (request, response) => {
  return response.status(200).json({
    success: true,

    message: "Authenticated user retrieved successfully",

    data: {
      user: toPublicUser(request.user),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Refresh Authentication
|--------------------------------------------------------------------------
*/

export const refresh = async (request, response) => {
  const refreshToken = request.cookies?.[AUTH_COOKIE_NAMES.REFRESH_TOKEN];

  const { user, tokens } = await refreshAuthentication(refreshToken, {
    ipAddress: request.ip,

    userAgent: request.headers["user-agent"],
  });

  setAuthCookies(response, tokens);

  return response.status(200).json({
    success: true,

    message: "Authentication refreshed successfully",

    data: {
      user: toPublicUser(user),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Logout User
|--------------------------------------------------------------------------
*/

export const logout = async (request, response) => {
  const refreshToken = request.cookies?.[AUTH_COOKIE_NAMES.REFRESH_TOKEN];

  try {
    await logoutAuthentication(refreshToken, {
      ipAddress: request.ip,
    });
  } finally {
    /*
     * Clear browser cookies even if an unexpected
     * database error occurs during session revocation.
     */
    clearAuthCookies(response);
  }

  return response.status(200).json({
    success: true,
    message: "Logout successful",
  });
};
