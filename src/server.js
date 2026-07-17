import app from "./app.js";

import connectDatabase from "./config/database.js";
import env from "./config/environment.js";
import logger from "./config/logger.js";

/*
| Start Application
*/

const startServer = async () => {
  try {
    await connectDatabase();

    const server = app.listen(env.PORT, () => {
      logger.info(
        {
          port: env.PORT,
          environment: env.NODE_ENV,
          url: `http://localhost:${env.PORT}`,
        },
        "HTTP server started",
      );
    });

    return server;
  } catch (error) {
    logger.fatal(
      {
        err: error,
      },
      "Application startup failed",
    );

    process.exit(1);
  }
};

startServer();
