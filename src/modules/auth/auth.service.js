import AppError from "../../shared/errors/app-error.js";

import { USER_STATUSES } from "../../shared/constants/user.constants.js";

import { hashToken } from "../../shared/utilities/token-hash.utility.js";

import {
  createCustomer,
  findRegistrationConflicts,
  findUserByEmailForAuthentication,
  updateUserLastLoginAt,
} from "../users/user.repository.js";

import {
  generateAuthTokens,
  verifyRefreshToken,
} from "./auth-token.service.js";

import { createRefreshSession } from "./refresh-session.repository.js";

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
