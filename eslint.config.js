import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', 'coverage/**', '**/dist/**', '**/.vercel/**'] },
  tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    // Loose JSON results in assertions are fine in tests.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // NFR-8: core reads time only through the injected Clock.
    files: ['packages/core/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          "NewExpression[callee.name='Date']",
          "CallExpression[callee.name='Date']",
          "MemberExpression[object.name='Date'][property.name='now']",
        ].map((selector) => ({
          selector,
          message: 'Use the injected Clock, not system time (NFR-8).',
        })),
      ],
    },
  },
);
