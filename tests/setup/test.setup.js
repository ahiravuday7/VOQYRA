import mongoose from "mongoose";

import { afterAll, beforeAll, beforeEach, inject } from "vitest";

/*
|--------------------------------------------------------------------------
| Test Environment Variables
|--------------------------------------------------------------------------
|
| These values are set before the application is
| imported by an integration-test file.
|--------------------------------------------------------------------------
*/

const mongoUri = inject("mongoUri");

process.env.NODE_ENV = "test";
process.env.PORT = "5001";

process.env.MONGODB_URI = mongoUri;

process.env.CLIENT_URL = "http://localhost:4200";

process.env.ADMIN_URL = "http://localhost:4300";

process.env.JWT_ACCESS_SECRET =
  "test-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

process.env.JWT_REFRESH_SECRET =
  "test-refresh-secret-9876543210-zyxwvutsrqponmlkjihgfedcba-ZYXWVUTSRQPONMLKJIHGFEDCBA";

process.env.JWT_ACCESS_EXPIRES_IN = "15m";

process.env.JWT_REFRESH_EXPIRES_IN = "7d";

process.env.JWT_ISSUER = "clothing-commerce-test-api";

process.env.JWT_AUDIENCE = "clothing-commerce-test-client";

process.env.AUTH_COOKIE_SAME_SITE = "lax";

/*
|--------------------------------------------------------------------------
| Connect Test Database
|--------------------------------------------------------------------------
*/

beforeAll(async () => {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10_000,
  });

  /*
   * Ensure indexes are created for all models
   * imported by the test file.
   */
  await Promise.all(
    Object.values(mongoose.models).map((model) => {
      return model.init();
    }),
  );
});

/*
|--------------------------------------------------------------------------
| Clean Collections Before Every Test
|--------------------------------------------------------------------------
|
| We delete records instead of dropping the
| database so unique and query indexes remain.
|--------------------------------------------------------------------------
*/

beforeEach(async () => {
  const database = mongoose.connection.db;

  if (!database) {
    return;
  }

  const collections = await database.collections();

  await Promise.all(
    collections.map((collection) => {
      return collection.deleteMany({});
    }),
  );
});

/*
|--------------------------------------------------------------------------
| Disconnect After Test File
|--------------------------------------------------------------------------
*/

afterAll(async () => {
  await mongoose.disconnect();
});
