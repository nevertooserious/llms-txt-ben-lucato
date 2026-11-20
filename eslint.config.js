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
) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { regex: `^(node:)?(${builtins.join('|')})(/.*)?$`, message },
        { regex: `^(${packages.join('|')})(/.*)?$`, message },
      ],
    },
  ],
});

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/.next/', '**/next-env.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/extractor/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      ...restrict(ioBuiltins, ioPackages, 'The extractor is a pure function from HTML to a PageRecord; it does no I/O.'),
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
