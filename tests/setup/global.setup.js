import { MongoMemoryReplSet } from "mongodb-memory-server";

/*
|--------------------------------------------------------------------------
| Global Integration-Test Setup
|--------------------------------------------------------------------------
|
| Starts one temporary MongoDB replica set before
| the integration-test suite begins.
|--------------------------------------------------------------------------
*/

export default async function globalSetup(project) {
  const replicaSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });

  const mongoUri = replicaSet.getUri("clothing_commerce_test");

  /*
   * Global setup runs in a different process.
   * project.provide() safely passes the URI to
   * the test workers.
   */
  project.provide("mongoUri", mongoUri);

  /*
   * Vitest runs this teardown after all test
   * files have finished.
   */
  return async () => {
    await replicaSet.stop();
  };
}
