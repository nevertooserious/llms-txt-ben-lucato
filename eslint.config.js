// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Network and database modules. Only the crawler may fetch from the web, and the
// extractor may not do I/O of any kind (docs/design/README.md, section 2).
const networkModules = ['node:http', 'node:https', 'node:net', 'node:dns', 'node:tls', 'undici', 'playwright'];
const ioModules = [...networkModules, 'node:fs', 'node:fs/promises', 'pg', 'pg-boss', '@llms-txt/db', '@llms-txt/crawler'];

const restrict = (/** @type {string[]} */ modules, /** @type {string} */ message) => ({
  'no-restricted-imports': ['error', { paths: modules.map((name) => ({ name, message })) }],
});

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/.next/', '**/next-env.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/extractor/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      ...restrict(ioModules, 'The extractor is a pure function from HTML to a PageRecord; it does no I/O.'),
      'no-restricted-globals': ['error', { name: 'fetch', message: 'The extractor does no I/O.' }],
    },
  },
  {
    files: ['packages/{contracts,generator,monitor,db}/src/**/*.ts', 'apps/**/*.{ts,tsx}'],
    rules: restrict(networkModules, 'The crawler owns all fetching of target sites, behind the SSRF guard.'),
  },
);
