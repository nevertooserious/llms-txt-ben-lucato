// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Network and database modules. Only the crawler may fetch from the web, and the
// extractor may not do I/O of any kind (docs/design/README.md, section 2).
// Builtins match with or without the `node:` prefix; all modules match subpaths too.
const networkBuiltins = ['http', 'https', 'http2', 'net', 'dns', 'tls', 'dgram'];
const networkPackages = ['undici', 'playwright', 'playwright-core'];
const ioBuiltins = [...networkBuiltins, 'fs'];
const ioPackages = [...networkPackages, 'pg', 'pg-boss', '@llms-txt/db', '@llms-txt/crawler'];

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
        { regex: `^(node:)?(${builtins.join('|')})(/.*)?$`, message },
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
    files: ['packages/{contracts,generator,monitor,db}/src/**/*.ts', 'apps/**/*.{ts,tsx}'],
    rules: restrict(
      networkBuiltins,
      networkPackages,
      'The crawler owns all fetching of target sites, behind the SSRF guard.',
    ),
  },
  // Server code may not call fetch either (LLM calls go through the Anthropic SDK);
  // browser components in apps/web may still fetch the app's own /api.
  {
    files: [
      'packages/{contracts,generator,monitor,db}/src/**/*.ts',
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
