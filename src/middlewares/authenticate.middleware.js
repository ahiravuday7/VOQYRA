import mongoose from "mongoose";

import { verifyAccessToken } from "../modules/auth/auth-token.service.js";

import { findUserByIdForAuthentication } from "../modules/users/user.repository.js";

import { AUTH_COOKIE_NAMES } from "../shared/constants/auth.constants.js";

import { USER_STATUSES } from "../shared/constants/user.constants.js";

import AppError from "../shared/errors/app-error.js";

/*
| Authentication Middleware
*/

const authenticate = async (request, response, next) => {
  /*
  | Read Access Token
  */

  const accessToken = request.cookies?.[AUTH_COOKIE_NAMES.ACCESS_TOKEN];

  if (!accessToken) {
    throw new AppError("Authentication is required", 401, {
      errorCode: "AUTHENTICATION_REQUIRED",
    });
  }

  /*
  | Verify Access Token
  */

  const tokenDetails = verifyAccessToken(accessToken);

  /*
  | Validate User ID
  */

  if (!mongoose.isValidObjectId(tokenDetails.userId)) {
    throw new AppError(
      "Access token contains an invalid user identifier",
      401,
      {
        errorCode: "INVALID_TOKEN_SUBJECT",
      },
    );
  }

  /*
  | Load Current User
  */

  const user = await findUserByIdForAuthentication(tokenDetails.userId);

  if (!user) {
    throw new AppError(
      "The account associated with this token no longer exists",
      401,
      {
        errorCode: "AUTHENTICATED_USER_NOT_FOUND",
      },
    );
  }

  /*
  | Check User Status
  */

  if (user.status === USER_STATUSES.BLOCKED) {
    throw new AppError("Your account has been blocked", 403, {
      errorCode: "ACCOUNT_BLOCKED",
    });
  }

  if (user.status === USER_STATUSES.INACTIVE) {
    throw new AppError("Your account is inactive", 403, {
      errorCode: "ACCOUNT_INACTIVE",
    });
  }

  if (user.status !== USER_STATUSES.ACTIVE) {
    throw new AppError("Your account is unavailable", 403, {
      errorCode: "ACCOUNT_UNAVAILABLE",
    });
  }

  /*
  | Check Password Change
  |
  | Tokens created before a password change must no longer be accepted.
  */

  if (user.hasPasswordChangedAfter(tokenDetails.issuedAt)) {
    throw new AppError(
      "Your password was changed after this token was issued. Please log in again.",
      401,
      {
        errorCode: "ACCESS_TOKEN_INVALIDATED",
      },
    );
  }

  /*
  | Attach Authentication Context
  */

  request.auth = {
    userId: user.id,
    tokenId: tokenDetails.tokenId,
    issuedAt: tokenDetails.issuedAt,
    expiresAt: tokenDetails.expiresAt,
  };

  request.user = user;

  return next();
};

export default authenticate;
