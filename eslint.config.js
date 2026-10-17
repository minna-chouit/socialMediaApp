import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', 'coverage/**', '**/dist/**', 'apps/mcp/api/**'] },
  tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
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
