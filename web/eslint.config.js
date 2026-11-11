import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default defineConfig([
  // vite.config.js and .d.ts: tsc -b output from before it moved to node_modules/.tmp, never sources.
  // src/generated: made by openapi-typescript (npm run gen:api), never edited, so not ours to lint.
  globalIgnores(['dist', 'node_modules', 'vite.config.js', 'vite.config.d.ts', 'src/generated']),
  js.configs.recommended,
  tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    // The two classic hook rules only. The plugin's v7 preset adds React Compiler
    // rules; this app does not use the compiler, and what they flag here are
    // working plain-React patterns (Date.now in render, resetting state in an effect).
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      // A scrolling region needs a Tab stop to scroll by keyboard (ExplainPanel's body).
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
    },
  },
  { languageOptions: { globals: globals.browser } },
  { files: ['scripts/**', '*.config.{js,ts}'], languageOptions: { globals: globals.node } },
]);
