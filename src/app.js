import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import env from "./config/environment.js";

import apiRateLimiter from "./middlewares/api-rate-limit.middleware.js";
import errorMiddleware from "./middlewares/error.middleware.js";
import notFoundMiddleware from "./middlewares/not-found.middleware.js";
import requestLoggerMiddleware from "./middlewares/request-logger.middleware.js";

import healthRoutes from "./routes/health.routes.js";

import authRoutes from "./modules/auth/auth.routes.js";

// This creates the Express application instance.
const app = express();

/*
| Basic Application Configuration
*/

app.disable("x-powered-by");

/*
| Request Logging
*/

app.use(requestLoggerMiddleware);

/*
| Security Middleware
*/

app.use(helmet());

const allowedOrigins = [env.CLIENT_URL, env.ADMIN_URL];

app.use(
  cors({
    origin(origin, callback) {
      /*
       * Requests without an Origin header include tools such as
       * Postman, Bruno, curl and server-to-server requests.
       */
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

/*
| Request Parsing Middleware
*/

// Parse incoming JSON request bodies
app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
  }),
);

app.use(cookieParser());

/*
| API Rate Limiting
*/

app.use("/api", apiRateLimiter);

/*
| Routes
*/

// Temporary root route
app.get("/", (request, response) => {
  return response.status(200).json({
    success: true,
    message: "Welcome to Clothing Commerce API",
  });
});

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);

/*
| 404 and Global Error Handling
|
| These must remain after all application routes.
*/

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
