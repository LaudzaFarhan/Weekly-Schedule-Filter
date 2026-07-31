import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test-only configuration. Next.js owns the application build; this file exists
// so unit and property tests can run outside the Next toolchain.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors the "@/*" -> "./src/*" mapping in jsconfig.json.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // `node` is the default because only the component/page tests need a DOM.
    // A jsdom environment costs roughly 1-2s per test file to construct, so the
    // pure-logic tests (src/lib, src/utils, src/services, src/app/api) used to
    // pay for a document they never touched. The files that do render opt in
    // with a `// @vitest-environment jsdom` docblock at the top of the file.
    // (vitest 4 removed `environmentMatchGlobs`, so the docblock is the
    // supported per-file mechanism.)
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
  },
});
