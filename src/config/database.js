import mongoose from "mongoose";

import env from "./environment.js";
import logger from "./logger.js";

/*
| Connect to MongoDB
*/

const connectDatabase = async () => {
  const connection = await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  logger.info(
    {
      host: connection.connection.host,
      database: connection.connection.name,
    },
    "MongoDB connected successfully",
  );
};

/*
| MongoDB Connection Events
*/

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected");
});

mongoose.connection.on("error", (error) => {
  logger.error(
    {
      err: error,
    },
    "MongoDB connection error",
  );
});

export default connectDatabase;
