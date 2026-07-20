import "dotenv/config";

import { z } from "zod";

// Here, Zod is being used to validate the environment variables before the server starts.
/*
| Environment Variable Schema
*/

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  PORT: z.coerce
    .number()
    .int("PORT must be a whole number")
    .min(1, "PORT must be greater than 0")
    .max(65535, "PORT cannot exceed 65535"),

  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required")
    .refine(
      (value) =>
        value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
      {
        message: "MONGODB_URI must be a valid MongoDB connection string",
      },
    ),

  CLIENT_URL: z.url({
    message: "CLIENT_URL must be a valid URL",
  }),

  ADMIN_URL: z.url({
    message: "ADMIN_URL must be a valid URL",
  }),

  JWT_ACCESS_SECRET: z
    .string()
    .min(64, "JWT_ACCESS_SECRET must contain at least 64 characters"),

  JWT_REFRESH_SECRET: z
    .string()
    .min(64, "JWT_REFRESH_SECRET must contain at least 64 characters"),

  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+[smhd]$/,
      "JWT_ACCESS_EXPIRES_IN must include a unit such as 15m",
    ),

  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+[smhd]$/,
      "JWT_REFRESH_EXPIRES_IN must include a unit such as 7d",
    ),

  JWT_ISSUER: z.string().min(1, "JWT_ISSUER is required"),

  JWT_AUDIENCE: z.string().min(1, "JWT_AUDIENCE is required"),

  AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
});

/*
| Validate Environment Variables
*/

const validationResult = environmentSchema.safeParse(process.env);

if (!validationResult.success) {
  console.error("\nEnvironment variable validation failed:\n");

  for (const issue of validationResult.error.issues) {
    const field = issue.path.join(".") || "unknown";

    console.error(`- ${field}: ${issue.message}`);
  }

  console.error("\nCheck your backend .env file and restart the server.\n");

  process.exit(1);
}

/*
| Validated Environment Configuration
*/

const env = Object.freeze(validationResult.data);

export default env;
