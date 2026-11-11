import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // The number of tests, for tools/check/facts.check.mjs to hold the documents' counts to: a test cannot be counted without running one.
    // Git ignores the file. It also holds every result, which only the counts are read from.
    reporters: ['default', 'json'],
    outputFile: { json: '.test-counts.json' },
    // Route tests mock '../clients/zabbix.js' per file; without isolation a mock from
    // one file would leak into the next through the ESM module cache.
    isolate: true,
    // Never load the developer's server/.env: its real tokens would reach every test, and CI would
    // fail what a laptop passes.
    // ZBX_URL points at nothing, so a call that escapes its mock fails instead of reaching Zabbix
    // on :8080.
    env: {
      DOTENV_CONFIG_PATH: 'no-dotenv-in-tests',
      DOTENV_CONFIG_QUIET: 'true',
      ZBX_URL: 'http://127.0.0.1:9/api_jsonrpc.php',
    },
  },
});
