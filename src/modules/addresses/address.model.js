import mongoose from "mongoose";

import {
  ADDRESS_TYPES,
  ADDRESS_TYPE_VALUES,
} from "../../shared/constants/address.constants.js";

const { Schema, model } = mongoose;

/*
| Helpers
*/

const normalizePhone = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalizedPhone = String(value)
    .trim()
    .replace(/[\s()-]/g, "");

  return normalizedPhone || undefined;
};

/*
| Address Schema
*/

const addressSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      index: true,
    },

    fullName: {
      type: String,
      required: [true, "Recipient name is required"],
      trim: true,
      minlength: [2, "Recipient name must contain at least 2 characters"],
      maxlength: [100, "Recipient name cannot exceed 100 characters"],
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      set: normalizePhone,
      match: [
        /^\+[1-9]\d{7,14}$/,
        "Phone number must use international format",
      ],
    },

    alternatePhone: {
      type: String,
      trim: true,
      default: undefined,
      set: normalizePhone,
      match: [
        /^\+[1-9]\d{7,14}$/,
        "Alternate phone number must use international format",
      ],
    },

    addressLine1: {
      type: String,
      required: [true, "Address line 1 is required"],
      trim: true,
      minlength: [3, "Address line 1 is too short"],
      maxlength: [150, "Address line 1 cannot exceed 150 characters"],
    },

    addressLine2: {
      type: String,
      trim: true,
      maxlength: [150, "Address line 2 cannot exceed 150 characters"],
      default: "",
    },

    landmark: {
      type: String,
      trim: true,
      maxlength: [100, "Landmark cannot exceed 100 characters"],
      default: "",
    },

    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
      maxlength: [80, "City cannot exceed 80 characters"],
    },

    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
      maxlength: [80, "State cannot exceed 80 characters"],
    },

    postalCode: {
      type: String,
      required: [true, "Postal code is required"],
      trim: true,
      uppercase: true,
      maxlength: [12, "Postal code cannot exceed 12 characters"],
    },

    country: {
      type: String,
      required: true,
      trim: true,
      default: "India",
      maxlength: 80,
    },

    /*
     * ISO 3166-1 alpha-2 country code.
     *
     * Examples:
     * India         → IN
     * United States → US
     */
    countryCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: "IN",
      match: [/^[A-Z]{2}$/, "Country code must contain 2 uppercase letters"],
    },

    addressType: {
      type: String,
      enum: {
        values: ADDRESS_TYPE_VALUES,
        message: "Invalid address type",
      },
      default: ADDRESS_TYPES.HOME,
    },

    /*
     * Optional custom label for an "other" address.
     *
     * Examples:
     * Parents' House
     * Warehouse
     * Reception
     */
    label: {
      type: String,
      trim: true,
      maxlength: [50, "Address label cannot exceed 50 characters"],
      default: "",
    },

    isDefaultShipping: {
      type: Boolean,
      default: false,
    },

    isDefaultBilling: {
      type: Boolean,
      default: false,
    },

    deliveryInstructions: {
      type: String,
      trim: true,
      maxlength: [300, "Delivery instructions cannot exceed 300 characters"],
      default: "",
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
    },

    toObject: {
      virtuals: true,
    },
  },
);

/*
| Indexes
*/

addressSchema.index(
  {
    user: 1,
    deletedAt: 1,
    createdAt: -1,
  },
  {
    name: "user_addresses_index",
  },
);

/*
 * A user can have only one active default shipping address.
 */
addressSchema.index(
  {
    user: 1,
    isDefaultShipping: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      isDefaultShipping: true,
      deletedAt: null,
    },

    name: "unique_default_shipping_address",
  },
);

/*
 * A user can have only one active default billing address.
 */
addressSchema.index(
  {
    user: 1,
    isDefaultBilling: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      isDefaultBilling: true,
      deletedAt: null,
    },

    name: "unique_default_billing_address",
  },
);

/*
| Virtual Fields
*/

addressSchema.virtual("isDeleted").get(function () {
  return Boolean(this.deletedAt);
});

addressSchema.virtual("formattedAddress").get(function () {
  return [
    this.addressLine1,
    this.addressLine2,
    this.landmark,
    this.city,
    this.state,
    this.postalCode,
    this.country,
  ]
    .filter(Boolean)
    .join(", ");
});

/*
| Validation
*/

addressSchema.pre("validate", function () {
  /*
   * Indian PIN codes contain exactly 6 digits and
   * cannot begin with zero.
   */
  if (this.countryCode === "IN" && !/^[1-9][0-9]{5}$/.test(this.postalCode)) {
    this.invalidate("postalCode", "Indian postal code must contain 6 digits");
  }

  /*
   * Basic postal-code validation for other countries.
   */
  if (
    this.countryCode !== "IN" &&
    !/^[A-Z0-9][A-Z0-9 -]{2,11}$/.test(this.postalCode)
  ) {
    this.invalidate("postalCode", "Enter a valid postal code");
  }

  if (this.alternatePhone && this.alternatePhone === this.phone) {
    this.invalidate(
      "alternatePhone",
      "Alternate phone number must be different",
    );
  }

  if (this.addressType === ADDRESS_TYPES.OTHER && !this.label) {
    this.invalidate("label", "A label is required for an other address");
  }
});

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

addressSchema.query.notDeleted = function () {
  return this.where({
    deletedAt: null,
  });
};

addressSchema.query.forUser = function (userId) {
  return this.where({
    user: userId,
    deletedAt: null,
  });
};

/*
|--------------------------------------------------------------------------
| Address Model
|--------------------------------------------------------------------------
*/

const Address = mongoose.models.Address || model("Address", addressSchema);

export default Address;
