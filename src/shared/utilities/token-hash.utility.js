import { createHash, timingSafeEqual } from "node:crypto";

/*
| Hash Token
*/

export const hashToken = (token) => {
  if (typeof token !== "string" || !token.trim()) {
    throw new TypeError("Token must be a non-empty string");
  }

  return createHash("sha256").update(token).digest("hex");
};

/*
| Safely Compare Token Hashes
*/

export const tokenHashesMatch = (firstHash, secondHash) => {
  if (typeof firstHash !== "string" || typeof secondHash !== "string") {
    return false;
  }

  const firstBuffer = Buffer.from(firstHash, "hex");

  const secondBuffer = Buffer.from(secondHash, "hex");

  if (firstBuffer.length !== secondBuffer.length) {
    return false;
  }

  return timingSafeEqual(firstBuffer, secondBuffer);
};
