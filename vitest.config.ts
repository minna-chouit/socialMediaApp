import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
