import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import {
  PASSWORD_HASH_ROUNDS,
  USER_ROLES,
  USER_ROLE_VALUES,
  USER_STATUSES,
  USER_STATUS_VALUES,
} from "../../shared/constants/user.constants.js";

const { Schema, model } = mongoose;

/*
| Helpers
*/

const normalizeOptionalPhone = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalizedPhone = String(value)
    .trim()
    .replace(/[\s()-]/g, "");

  return normalizedPhone || undefined;
};

const removePrivateFields = (document, returnedObject) => {
  delete returnedObject.password;

  return returnedObject;
};

/*
| Avatar Schema
*/

const avatarSchema = new Schema(
  {
    url: {
      type: String,
      trim: true,
      default: "",
    },

    publicId: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    _id: false,
  },
);

/*
| User Schema
*/

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      minlength: [2, "First name must contain at least 2 characters"],
      maxlength: [50, "First name cannot exceed 50 characters"],
    },

    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      minlength: [2, "Last name must contain at least 2 characters"],
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },

    email: {
      type: String,
      required: [true, "Email address is required"],
      trim: true,
      lowercase: true,
      maxlength: [254, "Email address is too long"],
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"],
    },

    /*
     * Store phone numbers in international format.
     *
     * Example:
     * +919876543210
     */
    phone: {
      type: String,
      trim: true,
      default: undefined,
      set: normalizeOptionalPhone,
      match: [
        /^\+[1-9]\d{7,14}$/,
        "Phone number must use international format",
      ],
    },

    password: {
      type: String,
      required: [true, "Password is required"],

      /*
       * Password must be explicitly selected during
       * login or another authentication operation.
       */
      select: false,

      validate: [
        {
          validator(value) {
            return Buffer.byteLength(value, "utf8") >= 8;
          },
          message: "Password must contain at least 8 bytes",
        },
        {
          validator(value) {
            return Buffer.byteLength(value, "utf8") <= 72;
          },
          message: "Password cannot exceed 72 bytes",
        },
      ],
    },

    role: {
      type: String,
      enum: {
        values: USER_ROLE_VALUES,
        message: "Invalid user role",
      },
      default: USER_ROLES.CUSTOMER,
      index: true,
    },

    status: {
      type: String,
      enum: {
        values: USER_STATUS_VALUES,
        message: "Invalid user status",
      },
      default: USER_STATUSES.ACTIVE,
      index: true,
    },

    avatar: {
      type: avatarSchema,
      default: () => ({}),
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerifiedAt: {
      type: Date,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
      select: false,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,

    toJSON: {
      virtuals: true,
      transform: removePrivateFields,
    },

    toObject: {
      virtuals: true,
      transform: removePrivateFields,
    },
  },
);

/*
| Database Indexes
*/

/*
 * unique creates a MongoDB unique index.
 * Duplicate-key errors must still be handled by
 * the global error middleware.
 */
userSchema.index(
  {
    email: 1,
  },
  {
    unique: true,
    name: "unique_user_email",
  },
);

/*
 * Phone is optional, but it must be unique when provided.
 */
userSchema.index(
  {
    phone: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      phone: {
        $type: "string",
      },
    },

    name: "unique_user_phone",
  },
);

userSchema.index(
  {
    role: 1,
    status: 1,
    deletedAt: 1,
  },
  {
    name: "user_role_status_index",
  },
);

userSchema.index(
  {
    createdAt: -1,
  },
  {
    name: "user_created_at_index",
  },
);

/*
| Virtual Fields
*/

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

/*
| Password Hashing
*/

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  const isExistingUser = !this.isNew;

  this.password = await bcrypt.hash(this.password, PASSWORD_HASH_ROUNDS);

  /*
   * Record password changes, but not initial account creation.
   */
  if (isExistingUser) {
    /*
     * Subtract one second to avoid a token issued during the
     * database operation being considered newer accidentally.
     */
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }
});

/*
| Instance Methods
*/

/**
 * Compare a plain-text password with the stored hash.
 *
 * The query must explicitly include password:
 *
 * User.findOne({ email }).select("+password")
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    throw new Error("Password was not selected for this user");
  }

  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check whether the password changed after a JWT was issued.
 *
 * jwtIssuedAt must be a Unix timestamp in seconds.
 */
userSchema.methods.hasPasswordChangedAfter = function (jwtIssuedAt) {
  if (!this.passwordChangedAt) {
    return false;
  }

  const passwordChangedTimestamp = Math.floor(
    this.passwordChangedAt.getTime() / 1000,
  );

  return passwordChangedTimestamp > jwtIssuedAt;
};

/*
| Static Methods
*/

/**
 * Find a user by email and explicitly include
 * password-related authentication fields.
 */
userSchema.statics.findByEmailForAuthentication = function (email) {
  const normalizedEmail = String(email).trim().toLowerCase();

  return this.findOne({
    email: normalizedEmail,
    deletedAt: null,
  }).select("+password +passwordChangedAt");
};

/*
| Query Helpers
*/

userSchema.query.active = function () {
  return this.where({
    status: USER_STATUSES.ACTIVE,
    deletedAt: null,
  });
};

userSchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

/*
| User Model
*/

const User = mongoose.models.User || model("User", userSchema);

export default User;
