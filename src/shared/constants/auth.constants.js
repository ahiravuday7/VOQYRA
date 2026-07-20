/*
| JWT Configuration
*/

export const JWT_ALGORITHM = "HS256";

/*
| Token Types
*/

export const TOKEN_TYPES = Object.freeze({
  ACCESS: "access",
  REFRESH: "refresh",
});

/*
| Refresh Token Revocation Reasons
*/

export const REFRESH_SESSION_REVOKE_REASONS = Object.freeze({
  LOGOUT: "logout",
  ROTATED: "rotated",
  PASSWORD_CHANGED: "password-changed",
  ACCOUNT_BLOCKED: "account-blocked",
  ACCOUNT_DELETED: "account-deleted",
  SECURITY: "security",
  ADMIN_ACTION: "admin-action",
});

export const REFRESH_SESSION_REVOKE_REASON_VALUES = Object.freeze(
  Object.values(REFRESH_SESSION_REVOKE_REASONS),
);

/* HS256 is a symmetric signing algorithm.

This means the same secret is used to:

generate the signature
verify the signature

Later, verification explicitly allows only this algorithm.

That prevents the application from trusting whichever algorithm an incoming token claims to use. */
