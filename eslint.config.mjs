// Flat ESLint config. Added to close EP-MAINT-01: the repo carried four
// `eslint-disable` directives targeting a linter that was never installed, so
// nothing enforced hook dependencies, unused code, or accidental `any`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'data/**',
      '.cache/**',
      'benchmarks/**',
      'evals/results/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly' },
    },
    rules: {
      // the four hand-written hooks are the reason this config exists: a stale
      // closure in useChat/useVoice/useTts/useTheme would fail silently
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off', // structured logging + CLI scripts legitimately print
    },
  },
  {
    // scripts and tests are tooling: looser, but still type-checked by tsc
    files: ['scripts/**/*.{ts,mjs}', 'tests/**/*.ts', '*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // a mock ModelProvider's generateStream legitimately throws instead of
      // yielding — that IS the behavior under test
      'require-yield': 'off',
    },
  },
  {
    // plain-Node CLI scripts: not browser, not bundled
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
);
