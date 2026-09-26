// Lint for the whole codebase: typescript-eslint's recommended rules, and the
// rules of hooks for the renderer. Rules switched off at the bottom are the
// ones whose findings are not mechanical to fix - see docs/refactor/phase-1.md.

import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Disable comments for rules switched off below stay: they record deliberate
  // exceptions for when those rules are switched back on.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  { ignores: ['out/', 'dist/', 'snapshots/', 'node_modules/', 'test/fixtures/', 'resources/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'src/main/**',
      'src/indexer/**',
      'src/embedder/**',
      'src/preload/**',
      'src/shared/**',
      'scripts/**',
      'test/**',
      'build/**',
      '*.config.*',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  // The snapshot script's page.evaluate() callbacks run in the app's renderer.
  { files: ['scripts/snapshots.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // CommonJS build hooks for electron-builder.
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    rules: {
      // TypeScript checks names itself; typescript-eslint recommends this off for TS.
      'no-undef': 'off',
      // A leading underscore marks a parameter or binding as deliberately unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    // Off for now: their findings are not mechanical fixes (phase 1 of the refactor
    // changes no behaviour). Each is listed, with its count, in docs/refactor/phase-1.md.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
    },
  },
)
