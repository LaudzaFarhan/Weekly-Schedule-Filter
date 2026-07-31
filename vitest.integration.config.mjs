import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests only. Kept in a separate config, with a separate glob and a
// separate npm script, so `npm run test` can never pick them up: they talk to a
// real PostgreSQL database and delete every row in the tables they touch.
//
// They also refuse to run unless WIPE_TEST_DATABASE_URL is set to a disposable
// database — see the header of tests/integration/bulkWipeStudents.integration.test.js
// for how to start one and how the guards work.
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the "@/*" -> "./src/*" mapping in jsconfig.json.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.integration.test.js'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
    // Real connections, real lock waits: the unit suite's defaults are too tight.
    testTimeout: 60000,
    hookTimeout: 60000,
    // Concurrent wipes are serialised by one advisory lock, so files must not
    // race each other for the same database.
    fileParallelism: false,
  },
});
