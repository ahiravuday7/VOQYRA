import { randomUUID } from "node:crypto";

import jwt from "jsonwebtoken";

import env from "../../config/environment.js";

import {
  JWT_ALGORITHM,
  TOKEN_TYPES,
} from "../../shared/constants/auth.constants.js";

import AppError from "../../shared/errors/app-error.js";

/*
| Sign Token
*/

const signToken = ({ userId, tokenType, secret, expiresIn }) => {
  return jwt.sign(
    {
      tokenType,
    },
    secret,
    {
      algorithm: JWT_ALGORITHM,

      /*
       * The user ID is stored in the standard
       * JWT subject claim.
       */
      subject: String(userId),

      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,

      expiresIn,

      /*
       * Unique identifier for this individual token.
       */
      jwtid: randomUUID(),
    },
  );
};

/*
| Generate Access Token
*/

export const generateAccessToken = (userId) => {
  return signToken({
    userId,
    tokenType: TOKEN_TYPES.ACCESS,
    secret: env.JWT_ACCESS_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
};

/*
| Generate Refresh Token
*/

export const generateRefreshToken = (userId) => {
  return signToken({
    userId,
    tokenType: TOKEN_TYPES.REFRESH,
    secret: env.JWT_REFRESH_SECRET,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  });
};

/*
| Generate Authentication Token Pair
*/

export const generateAuthTokens = (userId) => {
  return {
    accessToken: generateAccessToken(userId),

    refreshToken: generateRefreshToken(userId),
  };
};

/*
| Normalize JWT Verification Errors
*/

const createTokenError = (error, expectedTokenType) => {
  if (error?.name === "TokenExpiredError") {
    return new AppError(`${expectedTokenType} token has expired`, 401, {
      errorCode: "TOKEN_EXPIRED",
    });
  }

  if (error?.name === "NotBeforeError") {
    return new AppError(`${expectedTokenType} token is not active yet`, 401, {
      errorCode: "TOKEN_NOT_ACTIVE",
    });
  }

  return new AppError(`Invalid ${expectedTokenType} token`, 401, {
    errorCode: "INVALID_TOKEN",
  });
};

/*
|--------------------------------------------------------------------------
| Verify Token
|--------------------------------------------------------------------------
*/

const verifyToken = ({ token, secret, expectedTokenType }) => {
  if (typeof token !== "string" || !token.trim()) {
    throw new AppError(`${expectedTokenType} token is required`, 401, {
      errorCode: "TOKEN_REQUIRED",
    });
  }

  let decodedToken;

  try {
    decodedToken = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
  } catch (error) {
    throw createTokenError(error, expectedTokenType);
  }

  /*
   * jwt.verify can theoretically return a string.
   * Our application expects an object payload.
   */
  if (!decodedToken || typeof decodedToken !== "object") {
    throw new AppError(`Invalid ${expectedTokenType} token payload`, 401, {
      errorCode: "INVALID_TOKEN_PAYLOAD",
    });
  }

  if (decodedToken.tokenType !== expectedTokenType) {
    throw new AppError(`Invalid ${expectedTokenType} token type`, 401, {
      errorCode: "INVALID_TOKEN_TYPE",
    });
  }

  if (typeof decodedToken.sub !== "string" || !decodedToken.sub) {
    throw new AppError("Token does not contain a valid user identifier", 401, {
      errorCode: "INVALID_TOKEN_SUBJECT",
    });
  }

  if (typeof decodedToken.jti !== "string" || !decodedToken.jti) {
    throw new AppError("Token does not contain a valid token identifier", 401, {
      errorCode: "INVALID_TOKEN_ID",
    });
  }

  if (
    !Number.isInteger(decodedToken.iat) ||
    !Number.isInteger(decodedToken.exp)
  ) {
    throw new AppError("Token does not contain valid timestamps", 401, {
      errorCode: "INVALID_TOKEN_TIMESTAMPS",
    });
  }

  return {
    userId: decodedToken.sub,
    tokenId: decodedToken.jti,
    issuedAt: decodedToken.iat,
    expiresAt: decodedToken.exp,
  };
};

/*
|--------------------------------------------------------------------------
| Verify Access Token
|--------------------------------------------------------------------------
*/

export const verifyAccessToken = (token) => {
  return verifyToken({
    token,
    secret: env.JWT_ACCESS_SECRET,
    expectedTokenType: TOKEN_TYPES.ACCESS,
  });
};

/*
|--------------------------------------------------------------------------
| Verify Refresh Token
|--------------------------------------------------------------------------
*/

export const verifyRefreshToken = (token) => {
  return verifyToken({
    token,
    secret: env.JWT_REFRESH_SECRET,
    expectedTokenType: TOKEN_TYPES.REFRESH,
  });
};
