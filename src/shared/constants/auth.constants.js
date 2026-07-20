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

/* HS256 is a symmetric signing algorithm.

This means the same secret is used to:

generate the signature
verify the signature

Later, verification explicitly allows only this algorithm.

That prevents the application from trusting whichever algorithm an incoming token claims to use. */
