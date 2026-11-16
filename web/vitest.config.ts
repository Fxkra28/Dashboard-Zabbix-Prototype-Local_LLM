import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A test may read a file of the repository outside web/ as text (docs/api/openapi.yaml, `?raw`).
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // A page test waits up to 5 s for its answer (asyncUtilTimeout), so the test's own limit is longer: under load the shorter one fires first.
    testTimeout: 15_000,
    // The number of tests, for tools/check/facts.check.mjs to hold the documents' counts to. Git ignores the file.
    reporters: ['default', 'json'],
    outputFile: { json: '.test-counts.json' },
    // Measured only on request (`npm run test:coverage`). A report for each folder and file, and no threshold (IN-85). The file made from the API contract is not code to test.
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      reportOnFailure: true,
      include: ['src/**'],
      exclude: ['src/__tests__/**', 'src/**/*.test.{ts,tsx}', 'src/generated/**'],
      reportsDirectory: 'coverage',
    },
    setupFiles: ['src/__tests__/setup.ts'],
    // Vitest blanks every stylesheet by default; the tests read the stylesheet as text (src/__tests__/stylesheet.ts).
    css: { include: [/styles\/.*\.css/] },
    // Each file gets a fresh api/: its session state is module-level.
    isolate: true,
  },
});
