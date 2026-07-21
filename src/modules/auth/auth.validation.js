import * as z from "zod";

/*
| Reusable Field Schemas
*/

const firstNameSchema = z
  .string({
    error: "First name is required",
  })
  .trim()
  .min(2, {
    error: "First name must contain at least 2 characters",
  })
  .max(50, {
    error: "First name cannot exceed 50 characters",
  });

const lastNameSchema = z
  .string({
    error: "Last name is required",
  })
  .trim()
  .min(2, {
    error: "Last name must contain at least 2 characters",
  })
  .max(50, {
    error: "Last name cannot exceed 50 characters",
  });

/*
|--------------------------------------------------------------------------
| Email Schema
|
| The email is:
| 1. Trimmed
| 2. Converted to lowercase
| 3. Validated
|--------------------------------------------------------------------------
*/

const emailSchema = z
  .string({
    error: "Email address is required",
  })
  .trim()
  .toLowerCase()
  .pipe(
    z.email({
      error: "Enter a valid email address",
    }),
  );

/*
|--------------------------------------------------------------------------
| Optional Phone Schema
|
| Accepted:
| +919876543210
|
| Empty string becomes undefined.
|--------------------------------------------------------------------------
*/

const optionalPhoneSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string") {
      return value;
    }

    return value.trim().replace(/[\s()-]/g, "");
  },

  z
    .e164({
      error: "Phone number must use international format",
    })
    .optional(),
);

/*
|--------------------------------------------------------------------------
| Password Schema
|
| bcrypt safely supports passwords up to 72 bytes.
|--------------------------------------------------------------------------
*/

export const passwordSchema = z
  .string({
    error: "Password is required",
  })
  .refine(
    (value) => {
      return Buffer.byteLength(value, "utf8") >= 8;
    },
    {
      error: "Password must contain at least 8 characters",
    },
  )
  .refine(
    (value) => {
      return Buffer.byteLength(value, "utf8") <= 72;
    },
    {
      error: "Password cannot exceed 72 bytes",
    },
  )
  .regex(/[a-z]/, {
    error: "Password must contain a lowercase letter",
  })
  .regex(/[A-Z]/, {
    error: "Password must contain an uppercase letter",
  })
  .regex(/[0-9]/, {
    error: "Password must contain a number",
  })
  .regex(/[^A-Za-z0-9]/, {
    error: "Password must contain a special character",
  });

/*
|--------------------------------------------------------------------------
| Registration Body Schema
|
| z.strictObject rejects unexpected fields.
|
| This prevents users from submitting fields such as:
| role: "admin"
| status: "active"
| isEmailVerified: true
|--------------------------------------------------------------------------
*/

const registerBodySchema = z
  .strictObject({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: emailSchema,
    phone: optionalPhoneSchema,
    password: passwordSchema,

    confirmPassword: z.string({
      error: "Password confirmation is required",
    }),
  })
  .refine(
    (data) => {
      return data.password === data.confirmPassword;
    },
    {
      error: "Passwords do not match",
      path: ["confirmPassword"],
    },
  )
  .transform(({ confirmPassword, ...registrationData }) => {
    return registrationData;
  });

/*
|--------------------------------------------------------------------------
| Login Body Schema
|--------------------------------------------------------------------------
*/

const loginBodySchema = z.strictObject({
  email: emailSchema,

  password: z
    .string({
      error: "Password is required",
    })
    .min(1, {
      error: "Password is required",
    }),
});

/*
|--------------------------------------------------------------------------
| Complete Request Schemas
|--------------------------------------------------------------------------
|
| Registration and login currently accept:
| - body
| - no route parameters
| - no query parameters
|--------------------------------------------------------------------------
*/

export const registerRequestSchema = z.strictObject({
  body: registerBodySchema,
  params: z.strictObject({}),
  query: z.strictObject({}),
});

export const loginRequestSchema = z.strictObject({
  body: loginBodySchema,
  params: z.strictObject({}),
  query: z.strictObject({}),
});

/*
|--------------------------------------------------------------------------
| Empty Request Object
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({}),
);

/*
|--------------------------------------------------------------------------
| Refresh Request Schema
|--------------------------------------------------------------------------
*/

export const refreshRequestSchema = z.strictObject({
  body: emptyObjectSchema,
  params: emptyObjectSchema,
  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Logout Request Schema
|--------------------------------------------------------------------------
*/

export const logoutRequestSchema = z.strictObject({
  body: emptyObjectSchema,
  params: emptyObjectSchema,
  query: emptyObjectSchema,
});
