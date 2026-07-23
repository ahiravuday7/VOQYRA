import { USER_ROLE_VALUES } from "../shared/constants/user.constants.js";

import AppError from "../shared/errors/app-error.js";

/*
|--------------------------------------------------------------------------
| Role-Based Authorization Middleware
|--------------------------------------------------------------------------
|
| Usage:
|
| authorizeRoles("admin")
|
| authorizeRoles(
|   "admin",
|   "inventory-manager"
| )
|--------------------------------------------------------------------------
*/

const authorizeRoles = (...allowedRoles) => {
  /*
  | Validate Middleware Configuration
  */

  if (!allowedRoles.length) {
    throw new TypeError("At least one allowed role must be provided");
  }

  const invalidRoles = allowedRoles.filter((role) => {
    return !USER_ROLE_VALUES.includes(role);
  });

  if (invalidRoles.length) {
    throw new TypeError(
      `Invalid authorization role configuration: ${invalidRoles.join(", ")}`,
    );
  }

  const allowedRoleSet = new Set(allowedRoles);

  /*
  | Authorization Check
  */

  return (request, response, next) => {
    /*
     * authenticate middleware must run first.
     */
    if (!request.user) {
      throw new AppError("Authentication is required", 401, {
        errorCode: "AUTHENTICATION_REQUIRED",
      });
    }

    if (!allowedRoleSet.has(request.user.role)) {
      throw new AppError(
        "You do not have permission to perform this action",
        403,
        {
          errorCode: "ACCESS_FORBIDDEN",
        },
      );
    }

    return next();
  };
};

export default authorizeRoles;
