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
