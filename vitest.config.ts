import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // The web app's `@/` alias (apps/web/tsconfig.json). Each project below extends this.
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'apps/web/src') } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.database.test.ts'],
        },
      },
      {
        extends: true,
        // Needs DATABASE_URL pointing at a database with db/schema.sql applied; CI only.
        // Files run one at a time: they share the database, and a monitor tick in one
        // file claims every due site, including another file's.
        test: {
          name: 'database',
          fileParallelism: false,
          include: ['packages/*/src/**/*.database.test.ts', 'apps/*/src/**/*.database.test.ts'],
        },
      },
      {
        extends: true,
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
