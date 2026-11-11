import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig([
  // dist is tsc's output, never a source.
  globalIgnores(['dist', 'node_modules']),
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    rules: {
      // `const { secret: _, ...rest } = x` leaves a name out of a copy, and `_name` marks an argument a callback must take and does not read.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
]);
