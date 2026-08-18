import "dotenv/config";

import { z } from "zod";

// Here, Zod is being used to validate the environment variables before the server starts.
/*
| Environment Variable Schema
*/

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

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

  RAZORPAY_KEY_ID: z.string().trim().min(1, "RAZORPAY_KEY_ID is required"),

  RAZORPAY_KEY_SECRET: z
    .string()
    .trim()
    .min(1, "RAZORPAY_KEY_SECRET is required"),

  RAZORPAY_WEBHOOK_SECRET: z
    .string()
    .trim()
    .min(32, "RAZORPAY_WEBHOOK_SECRET must contain at least 32 characters"),

  /*
|--------------------------------------------------------------------------
| Online Order Inventory Reservation
|--------------------------------------------------------------------------
*/

  ONLINE_ORDER_RESERVATION_TTL_MINUTES: z.coerce
    .number()
    .int("ONLINE_ORDER_RESERVATION_TTL_MINUTES must be a whole number")
    .min(5, "ONLINE_ORDER_RESERVATION_TTL_MINUTES must be at least 5 minutes")
    .max(
      1440,
      "ONLINE_ORDER_RESERVATION_TTL_MINUTES cannot exceed 1440 minutes",
    )
    .default(30),

  /*
|--------------------------------------------------------------------------
| Online Order Reservation Expiry Worker
|--------------------------------------------------------------------------
*/

  ONLINE_ORDER_RESERVATION_WORKER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(10_000),

  ONLINE_ORDER_RESERVATION_WORKER_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25),

  /*
|--------------------------------------------------------------------------
| Payment Reconciliation Worker
|--------------------------------------------------------------------------
|
| This worker is a recovery safety net.
|
| Normal payment completion should still happen through:
|
| - browser confirmation
| - Razorpay webhook processing
|
| Reconciliation exists for cases where PaymentTransaction reached "paid"
| but Order finalization did not complete.
|--------------------------------------------------------------------------
*/

  PAYMENT_RECONCILIATION_WORKER_INTERVAL_MS: z.coerce
    .number()
    .int("PAYMENT_RECONCILIATION_WORKER_INTERVAL_MS must be a whole number")
    .min(
      5_000,
      "PAYMENT_RECONCILIATION_WORKER_INTERVAL_MS must be at least 5000ms",
    )
    .max(
      300_000,
      "PAYMENT_RECONCILIATION_WORKER_INTERVAL_MS cannot exceed 300000ms",
    )
    .default(30_000),

  PAYMENT_RECONCILIATION_WORKER_BATCH_SIZE: z.coerce
    .number()
    .int("PAYMENT_RECONCILIATION_WORKER_BATCH_SIZE must be a whole number")
    .min(1, "PAYMENT_RECONCILIATION_WORKER_BATCH_SIZE must be at least 1")
    .max(100, "PAYMENT_RECONCILIATION_WORKER_BATCH_SIZE cannot exceed 100")
    .default(25),

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
