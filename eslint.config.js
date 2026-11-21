// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Component boundaries (docs/design/README.md, sections 2 and 3):
//   - only the crawler may fetch from the web (network modules);
//   - the extractor does no I/O of any kind;
//   - only @llms-txt/db may import `pg`, so every SQL query lives there;
//   - the pure stages (extractor, generator) and contracts do not touch the database or
//     the queue: the worker loads their inputs and stores their outputs.
// Builtins match with or without the `node:` prefix; all modules match subpaths too.
// ESLint does not merge `no-restricted-imports` across config blocks, so each group of
// files gets exactly one block below with its full list.
const networkBuiltins = ['http', 'https', 'http2', 'net', 'dns', 'tls', 'dgram'];
const networkPackages = ['undici', 'playwright', 'playwright-core'];
const databasePackages = ['pg', 'pg-boss', '@llms-txt/db'];
const ioBuiltins = [...networkBuiltins, 'fs'];
const ioPackages = [...networkPackages, ...databasePackages, '@llms-txt/crawler'];

const NETWORK_MESSAGE = 'The crawler owns all fetching of target sites, behind the SSRF guard.';
const SQL_MESSAGE = 'SQL lives in @llms-txt/db; call its functions instead of importing pg.';
const PURE_MESSAGE = 'Contracts and pure stages do not touch the database or the queue; the worker does.';

const restrict = (
  /** @type {string[]} */ builtins,
  /** @type {string[]} */ packages,
  /** @type {string} */ message,
  /** @type {{ regex: string, message: string }[]} */ extraPatterns = [],
) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        ...(builtins.length > 0 ? [{ regex: `^(node:)?(${builtins.join('|')})(/.*)?$`, message }] : []),
        { regex: `^(${packages.join('|')})(/.*)?$`, message },
        ...extraPatterns,
      ],
    },
  ],
});

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/.next/', '**/next-env.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Scripts the fixture sites serve to the headless browser: plain browser JavaScript.
  {
    files: ['e2e/fixture-sites/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        XMLHttpRequest: 'readonly',
      },
    },
  },
  {
    files: ['packages/extractor/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      ...restrict(ioBuiltins, ioPackages, 'The extractor is a pure function from HTML to a PageRecord; it does no I/O.', [
        // The main cheerio entry bundles an HTTP client (fromURL); cheerio/slim does not.
        { regex: '^cheerio$', message: 'Import cheerio/slim: the main cheerio entry bundles an HTTP client.' },
      ]),
      'no-restricted-globals': ['error', { name: 'fetch', message: 'The extractor does no I/O.' }],
    },
  },
  {
    files: ['packages/{contracts,generator}/src/**/*.ts'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE, [
      { regex: `^(${databasePackages.join('|')}|@llms-txt/crawler)(/.*)?$`, message: PURE_MESSAGE },
    ]),
  },
  {
    files: ['packages/crawler/src/**/*.ts'],
    rules: restrict([], databasePackages, 'The crawler returns what it fetched; the worker stores it.'),
  },
  {
    files: ['packages/{monitor,runtime}/src/**/*.ts', 'apps/**/*.{ts,tsx}'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE, [{ regex: '^pg(/.*)?$', message: SQL_MESSAGE }]),
  },
  {
    files: ['packages/db/src/**/*.ts'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE),
  },
  // Server code may not call fetch either (LLM calls go through the Anthropic SDK);
  // browser components in apps/web may still fetch the app's own /api.
  {
    files: [
      'packages/{contracts,generator,monitor,db,runtime}/src/**/*.ts',
      'apps/worker/**/*.ts',
      'apps/web/src/app/**/route.ts',
      'apps/web/src/server/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'The crawler owns all fetching of target sites, behind the SSRF guard.' },
      ],
    },
  },
);
