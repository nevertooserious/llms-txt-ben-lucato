import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
        },
      },
      {
        // Runs the whole pipeline against the local sites in e2e/fixture-sites.
        test: {
          name: 'e2e',
          include: ['e2e/tests/**/*.test.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
