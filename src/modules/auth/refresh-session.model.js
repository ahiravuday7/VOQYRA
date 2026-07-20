import mongoose from "mongoose";

import { REFRESH_SESSION_REVOKE_REASON_VALUES } from "../../shared/constants/auth.constants.js";

const { Schema, model } = mongoose;

/*
| Refresh Session Schema
|
| One document represents one issued refresh token.
*/

const refreshSessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Refresh-session user is required"],
      index: true,
    },

    /*
     * JWT ID from the refresh token's jti claim.
     */
    tokenId: {
      type: String,
      required: [true, "Refresh token ID is required"],
      trim: true,
    },

    /*
     * SHA-256 hash of the complete refresh token.
     *
     * The raw token is never stored.
     */
    tokenHash: {
      type: String,
      required: [true, "Refresh token hash is required"],
      select: false,
    },

    expiresAt: {
      type: Date,
      required: [true, "Refresh-session expiration is required"],
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedReason: {
      type: String,
      enum: {
        values: REFRESH_SESSION_REVOKE_REASON_VALUES,

        message: "Invalid refresh-session revocation reason",
      },
      default: null,
    },

    /*
     * When the session is rotated, this points to
     * the new refresh token's jti.
     */
    replacedByTokenId: {
      type: String,
      trim: true,
      default: null,
    },

    createdByIp: {
      type: String,
      trim: true,
      maxlength: [100, "IP address cannot exceed 100 characters"],
      default: "",
    },

    lastUsedIp: {
      type: String,
      trim: true,
      maxlength: [100, "IP address cannot exceed 100 characters"],
      default: "",
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: [500, "User agent cannot exceed 500 characters"],
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,

    toJSON: {
      virtuals: true,
      transform(document, returnedObject) {
        delete returnedObject.tokenHash;

        return returnedObject;
      },
    },

    toObject: {
      virtuals: true,
      transform(document, returnedObject) {
        delete returnedObject.tokenHash;

        return returnedObject;
      },
    },
  },
);

/*
|--------------------------------------------------------------------------
| Database Indexes
|--------------------------------------------------------------------------
*/

/*
 * Every issued refresh token has a unique jti.
 */
refreshSessionSchema.index(
  {
    tokenId: 1,
  },
  {
    unique: true,
    name: "unique_refresh_session_token_id",
  },
);

/*
 * Every stored token hash must also be unique.
 */
refreshSessionSchema.index(
  {
    tokenHash: 1,
  },
  {
    unique: true,
    name: "unique_refresh_session_token_hash",
  },
);

/*
 * Quickly find active sessions belonging to a user.
 */
refreshSessionSchema.index(
  {
    user: 1,
    revokedAt: 1,
    expiresAt: 1,
  },
  {
    name: "user_active_refresh_sessions_index",
  },
);

/*
 * MongoDB automatically removes expired sessions.
 *
 * expireAfterSeconds: 0 means expiresAt contains
 * the exact expiration date.
 */
refreshSessionSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    name: "refresh_session_expiration_index",
  },
);

/*
|--------------------------------------------------------------------------
| Virtual Fields
|--------------------------------------------------------------------------
*/

refreshSessionSchema.virtual("isExpired").get(function () {
  return this.expiresAt.getTime() <= Date.now();
});

refreshSessionSchema.virtual("isRevoked").get(function () {
  return Boolean(this.revokedAt);
});

refreshSessionSchema.virtual("isActive").get(function () {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
});

/*
|--------------------------------------------------------------------------
| Instance Methods
|--------------------------------------------------------------------------
*/

/**
 * Revoke this refresh session.
 */
refreshSessionSchema.methods.revoke = function ({
  reason,
  replacedByTokenId = null,
}) {
  if (this.revokedAt) {
    return this;
  }

  this.revokedAt = new Date();
  this.revokedReason = reason;
  this.replacedByTokenId = replacedByTokenId;

  return this;
};

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

refreshSessionSchema.query.active = function () {
  return this.where({
    revokedAt: null,

    expiresAt: {
      $gt: new Date(),
    },
  });
};

refreshSessionSchema.query.forUser = function (userId) {
  return this.where({
    user: userId,
  });
};

/*
|--------------------------------------------------------------------------
| Refresh Session Model
|--------------------------------------------------------------------------
*/

const RefreshSession =
  mongoose.models.RefreshSession ||
  model("RefreshSession", refreshSessionSchema);

export default RefreshSession;
