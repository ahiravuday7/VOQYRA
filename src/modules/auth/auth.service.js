import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import { USER_STATUSES } from "../../shared/constants/user.constants.js";

import {
  hashToken,
  tokenHashesMatch,
} from "../../shared/utilities/token-hash.utility.js";

import {
  createCustomer,
  findRegistrationConflicts,
  findUserByEmailForAuthentication,
  updateUserLastLoginAt,
  findUserByIdForAuthentication,
} from "../users/user.repository.js";

import {
  generateAuthTokens,
  verifyRefreshToken,
} from "./auth-token.service.js";

import {
  createRefreshSession,
  findRefreshSessionByTokenId,
  revokeActiveRefreshSessionsForUser,
  rotateActiveRefreshSession,
} from "./refresh-session.repository.js";

import { REFRESH_SESSION_REVOKE_REASONS } from "../../shared/constants/auth.constants.js";

/*
| Invalid Credentials Error
*/

const createInvalidCredentialsError = () => {
  return new AppError("Invalid email or password", 401, {
    errorCode: "INVALID_CREDENTIALS",
  });
};

/*
| Register Customer
*/

export const registerCustomer = async (registrationData) => {
  const { firstName, lastName, email, phone, password } = registrationData;

  const conflicts = await findRegistrationConflicts({
    email,
    phone,
  });

  const emailAlreadyExists = conflicts.some((user) => {
    return user.email === email;
  });

  if (emailAlreadyExists) {
    throw new AppError(
      "An account with this email address already exists",
      409,
      {
        errorCode: "EMAIL_ALREADY_REGISTERED",
      },
    );
  }

  const phoneAlreadyExists =
    phone &&
    conflicts.some((user) => {
      return user.phone === phone;
    });

  if (phoneAlreadyExists) {
    throw new AppError(
      "An account with this phone number already exists",
      409,
      {
        errorCode: "PHONE_ALREADY_REGISTERED",
      },
    );
  }

  return createCustomer({
    firstName,
    lastName,
    email,
    phone,
    password,
  });
};

/*
|--------------------------------------------------------------------------
| Login User
|--------------------------------------------------------------------------
*/

export const loginUser = async (credentials, requestMetadata = {}) => {
  const { email, password } = credentials;

  const user = await findUserByEmailForAuthentication(email);

  /*
   * Use the same error message for:
   * - Unknown email
   * - Wrong password
   */
  if (!user) {
    throw createInvalidCredentialsError();
  }

  const passwordIsCorrect = await user.comparePassword(password);

  if (!passwordIsCorrect) {
    throw createInvalidCredentialsError();
  }

  /*
  | Account Status Validation
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
    throw new AppError("Your account cannot be used to log in", 403, {
      errorCode: "ACCOUNT_UNAVAILABLE",
    });
  }

  /*
  | Generate Token Pair
  */

  const tokens = generateAuthTokens(user._id);

  /*
   * Verify our generated refresh token so we can
   * obtain jti and expiration information.
   */
  const refreshTokenDetails = verifyRefreshToken(tokens.refreshToken);

  /*
  | Create Refresh Session
  */

  const ipAddress =
    typeof requestMetadata.ipAddress === "string"
      ? requestMetadata.ipAddress.slice(0, 100)
      : "";

  const userAgent =
    typeof requestMetadata.userAgent === "string"
      ? requestMetadata.userAgent.slice(0, 500)
      : "";

  await createRefreshSession({
    user: user._id,

    tokenId: refreshTokenDetails.tokenId,

    tokenHash: hashToken(tokens.refreshToken),

    expiresAt: new Date(refreshTokenDetails.expiresAt * 1000),

    createdByIp: ipAddress,
    lastUsedIp: ipAddress,
    userAgent,
  });

  /*
  | Update Last Login
  */

  const loginTime = new Date();

  await updateUserLastLoginAt(user._id, loginTime);

  user.lastLoginAt = loginTime;

  return {
    user,
    tokens,
  };
};

/*
|--------------------------------------------------------------------------
| Refresh Authentication
|--------------------------------------------------------------------------
*/

export const refreshAuthentication = async (
  rawRefreshToken,
  requestMetadata = {},
) => {
  if (!rawRefreshToken) {
    throw new AppError("Refresh token is required", 401, {
      errorCode: "REFRESH_TOKEN_REQUIRED",
    });
  }

  /*
    | Verify JWT Signature and Claims
    */

  const tokenDetails = verifyRefreshToken(rawRefreshToken);

  if (!mongoose.isValidObjectId(tokenDetails.userId)) {
    throw new AppError(
      "Refresh token contains an invalid user identifier",
      401,
      {
        errorCode: "INVALID_TOKEN_SUBJECT",
      },
    );
  }

  const incomingTokenHash = hashToken(rawRefreshToken);

  const ipAddress =
    typeof requestMetadata.ipAddress === "string"
      ? requestMetadata.ipAddress.slice(0, 100)
      : "";

  const userAgent =
    typeof requestMetadata.userAgent === "string"
      ? requestMetadata.userAgent.slice(0, 500)
      : "";

  let transactionOutcome = null;

  /*
    | Rotate Session in a Transaction
    */

  await mongoose.connection.transaction(async (databaseSession) => {
    /*
     * The callback may be retried for a transient
     * transaction error, so reset the outcome.
     */
    transactionOutcome = null;

    const storedSession = await findRefreshSessionByTokenId(
      tokenDetails.tokenId,
      {
        session: databaseSession,
      },
    );

    if (!storedSession) {
      transactionOutcome = {
        error: new AppError("Refresh session is no longer available", 401, {
          errorCode: "REFRESH_SESSION_NOT_FOUND",
        }),
      };

      return;
    }

    const storedUserId = String(storedSession.user);

    /*
        | Verify Exact Token
        */

    const userMatches = storedUserId === tokenDetails.userId;

    const hashMatches = tokenHashesMatch(
      storedSession.tokenHash,
      incomingTokenHash,
    );

    if (!userMatches || !hashMatches) {
      transactionOutcome = {
        error: new AppError("Refresh token is invalid", 401, {
          errorCode: "INVALID_REFRESH_TOKEN",
        }),
      };

      return;
    }

    /*
        | Detect Token Reuse
        */

    if (storedSession.revokedAt) {
      if (
        storedSession.revokedReason === REFRESH_SESSION_REVOKE_REASONS.ROTATED
      ) {
        /*
         * A rotated token was presented again.
         * Revoke every active session belonging
         * to the user as a security response.
         */
        await revokeActiveRefreshSessionsForUser(
          storedSession.user,

          REFRESH_SESSION_REVOKE_REASONS.SECURITY,

          {
            session: databaseSession,
          },
        );

        transactionOutcome = {
          error: new AppError(
            "Refresh token reuse was detected. Please log in again.",
            401,
            {
              errorCode: "REFRESH_TOKEN_REUSE_DETECTED",
            },
          ),
        };

        return;
      }

      transactionOutcome = {
        error: new AppError("Refresh session has been revoked", 401, {
          errorCode: "REFRESH_SESSION_REVOKED",
        }),
      };

      return;
    }

    /*
        | Check Session Expiration
        */

    if (storedSession.expiresAt.getTime() <= Date.now()) {
      transactionOutcome = {
        error: new AppError("Refresh session has expired", 401, {
          errorCode: "REFRESH_SESSION_EXPIRED",
        }),
      };

      return;
    }

    /*
        | Load Current User
        */

    const user = await findUserByIdForAuthentication(tokenDetails.userId, {
      session: databaseSession,
    });

    if (!user) {
      await revokeActiveRefreshSessionsForUser(
        storedSession.user,

        REFRESH_SESSION_REVOKE_REASONS.ACCOUNT_DELETED,

        {
          session: databaseSession,
        },
      );

      transactionOutcome = {
        error: new AppError(
          "The account associated with this session no longer exists",
          401,
          {
            errorCode: "AUTHENTICATED_USER_NOT_FOUND",
          },
        ),
      };

      return;
    }

    /*
        | Check Account Status
        */

    if (user.status === USER_STATUSES.BLOCKED) {
      await revokeActiveRefreshSessionsForUser(
        user._id,

        REFRESH_SESSION_REVOKE_REASONS.ACCOUNT_BLOCKED,

        {
          session: databaseSession,
        },
      );

      transactionOutcome = {
        error: new AppError("Your account has been blocked", 403, {
          errorCode: "ACCOUNT_BLOCKED",
        }),
      };

      return;
    }

    if (user.status !== USER_STATUSES.ACTIVE) {
      await revokeActiveRefreshSessionsForUser(
        user._id,

        REFRESH_SESSION_REVOKE_REASONS.SECURITY,

        {
          session: databaseSession,
        },
      );

      transactionOutcome = {
        error: new AppError("Your account is unavailable", 403, {
          errorCode: "ACCOUNT_UNAVAILABLE",
        }),
      };

      return;
    }

    /*
        | Check Password Change
        */

    if (user.hasPasswordChangedAfter(tokenDetails.issuedAt)) {
      await revokeActiveRefreshSessionsForUser(
        user._id,

        REFRESH_SESSION_REVOKE_REASONS.PASSWORD_CHANGED,

        {
          session: databaseSession,
        },
      );

      transactionOutcome = {
        error: new AppError(
          "Your password was changed after this session was created. Please log in again.",
          401,
          {
            errorCode: "REFRESH_SESSION_INVALIDATED",
          },
        ),
      };

      return;
    }

    /*
        |--------------------------------------------------------------------------
        | Generate Replacement Tokens
        |--------------------------------------------------------------------------
        */

    const tokens = generateAuthTokens(user._id);

    const replacementDetails = verifyRefreshToken(tokens.refreshToken);

    /*
        |--------------------------------------------------------------------------
        | Revoke Old Session Atomically
        |--------------------------------------------------------------------------
        */

    const rotatedSession = await rotateActiveRefreshSession(
      {
        sessionId: storedSession._id,

        replacedByTokenId: replacementDetails.tokenId,

        lastUsedIp: ipAddress,
      },
      {
        session: databaseSession,
      },
    );

    /*
     * If another request already rotated this
     * session, treat this request as reuse.
     */
    if (!rotatedSession) {
      await revokeActiveRefreshSessionsForUser(
        user._id,

        REFRESH_SESSION_REVOKE_REASONS.SECURITY,

        {
          session: databaseSession,
        },
      );

      transactionOutcome = {
        error: new AppError(
          "Refresh token reuse was detected. Please log in again.",
          401,
          {
            errorCode: "REFRESH_TOKEN_REUSE_DETECTED",
          },
        ),
      };

      return;
    }

    /*
        |--------------------------------------------------------------------------
        | Create Replacement Session
        |--------------------------------------------------------------------------
        */

    await createRefreshSession(
      {
        user: user._id,

        tokenId: replacementDetails.tokenId,

        tokenHash: hashToken(tokens.refreshToken),

        expiresAt: new Date(replacementDetails.expiresAt * 1000),

        createdByIp: ipAddress,

        lastUsedIp: ipAddress,

        userAgent,
      },
      {
        session: databaseSession,
      },
    );

    transactionOutcome = {
      user,
      tokens,
    };
  });

  /*
    |--------------------------------------------------------------------------
    | Return or Throw After Transaction Commits
    |--------------------------------------------------------------------------
    |
    | Security revocations must commit before the
    | error is thrown.
    |--------------------------------------------------------------------------
    */

  if (transactionOutcome?.error) {
    throw transactionOutcome.error;
  }

  if (!transactionOutcome?.user || !transactionOutcome?.tokens) {
    throw new AppError("Authentication refresh failed", 500, {
      errorCode: "REFRESH_OPERATION_FAILED",
    });
  }

  return transactionOutcome;
};
