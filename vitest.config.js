import { defineConfig } from "vitest/config";

/*
|--------------------------------------------------------------------------
| Vitest Configuration
|--------------------------------------------------------------------------
*/

export default defineConfig({
  test: {
    environment: "node",

    include: ["tests/**/*.test.js"],

    globalSetup: ["./tests/setup/global.setup.js"],

    setupFiles: ["./tests/setup/test.setup.js"],

    /*
     * The test database is shared by the test
     * files, so execute files sequentially.
     */
    fileParallelism: false,
    maxWorkers: 1,

    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,

    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
