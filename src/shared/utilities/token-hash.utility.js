import { createHash } from "node:crypto";

/*
| Hash Token
|
| Raw refresh tokens must not be stored in MongoDB.
*/

export const hashToken = (token) => {
  if (typeof token !== "string" || !token.trim()) {
    throw new TypeError("Token must be a non-empty string");
  }

  return createHash("sha256").update(token).digest("hex");
};
