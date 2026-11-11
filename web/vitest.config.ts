import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A test may read a file of the repository outside web/ as text (docs/api/openapi.yaml, `?raw`).
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // The number of tests, for tools/check/facts.check.mjs to hold the documents' counts to. Git ignores the file.
    reporters: ['default', 'json'],
    outputFile: { json: '.test-counts.json' },
    setupFiles: ['src/__tests__/setup.ts'],
    // Vitest blanks every stylesheet by default; the tests read the stylesheet as text (src/__tests__/stylesheet.ts).
    css: { include: [/styles\/.*\.css/] },
    // Each file gets a fresh api/: its session state is module-level.
    isolate: true,
  },
});
