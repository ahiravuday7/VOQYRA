import env from "../../config/environment.js";

import {
  AUTH_COOKIE_NAMES,
  AUTH_COOKIE_PATHS,
} from "../../shared/constants/auth.constants.js";

import { durationToMilliseconds } from "../../shared/utilities/duration.utility.js";

/*
| Common Cookie Options
*/

const commonCookieOptions = Object.freeze({
  httpOnly: true,

  /*
   * Secure cookies are enabled automatically
   * in production.
   */
  secure: env.NODE_ENV === "production",

  sameSite: env.AUTH_COOKIE_SAME_SITE,
});

/*
| Access Token Cookie Options
*/

const accessTokenCookieOptions = {
  ...commonCookieOptions,

  path: AUTH_COOKIE_PATHS.ACCESS_TOKEN,

  maxAge: durationToMilliseconds(env.JWT_ACCESS_EXPIRES_IN),
};

/*
| Refresh Token Cookie Options
*/

const refreshTokenCookieOptions = {
  ...commonCookieOptions,

  /*
   * The refresh token is sent only to
   * authentication endpoints.
   */
  path: AUTH_COOKIE_PATHS.REFRESH_TOKEN,

  maxAge: durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN),
};

/*
| Set Authentication Cookies
*/

export const setAuthCookies = (response, { accessToken, refreshToken }) => {
  response.cookie(
    AUTH_COOKIE_NAMES.ACCESS_TOKEN,
    accessToken,
    accessTokenCookieOptions,
  );

  response.cookie(
    AUTH_COOKIE_NAMES.REFRESH_TOKEN,
    refreshToken,
    refreshTokenCookieOptions,
  );
};

/*
|--------------------------------------------------------------------------
| Clear Authentication Cookies
|--------------------------------------------------------------------------
|
| Cookie path and security options must match
| the options used when the cookies were created.
|--------------------------------------------------------------------------
*/

export const clearAuthCookies = (response) => {
  response.clearCookie(AUTH_COOKIE_NAMES.ACCESS_TOKEN, {
    ...commonCookieOptions,

    path: AUTH_COOKIE_PATHS.ACCESS_TOKEN,
  });

  response.clearCookie(AUTH_COOKIE_NAMES.REFRESH_TOKEN, {
    ...commonCookieOptions,

    path: AUTH_COOKIE_PATHS.REFRESH_TOKEN,
  });
};
