// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Component boundaries (docs/design/README.md, sections 2 and 3):
//   - only the crawler may fetch from the web (network modules);
//   - the extractor does no I/O of any kind;
//   - only @llms-txt/db may import `pg`, so every SQL query lives there;
//   - the pure stages (extractor, generator) and contracts do not touch the database or
//     the queue: the worker loads their inputs and stores their outputs.
//
// Layers inside a component (README.md, "Inside a component"):
//   - in the crawler, only `network/` may open a connection, so every request is made by
//     code that sits beside the SSRF guard;
//   - in @llms-txt/db, only `connection/` may import `pg`;
//   - in the worker, the pipeline is handed its dependencies and does not reach for the
//     composition root's;
//   - the worker's `pipeline/decisions/` is pure: no I/O, and only types from @llms-txt/db;
//   - the monitor only schedules runs, so it does not import the stages a run calls;
//   - packages are imported through their entry point, and only along `packageDependencies`;
//   - only the worker's `llm/` imports the Anthropic SDK, so no call skips the LLM cache;
//   - the pure stages and decisions read no clock or randomness, so equal inputs render equally;
//   - only the config modules read `process.env`.
//   - in the web app, `app/` routes call `server/` and render `features/`; `server/` and
//     the browser code (`features/`, `browser/`) share only `shared/`.
// Builtins match with or without the `node:` prefix; all modules match subpaths too.
// ESLint does not merge `no-restricted-imports` across config blocks, so each group of
// files gets exactly one block below with its full list.
const networkBuiltins = ['http', 'https', 'http2', 'net', 'dns', 'tls', 'dgram'];
const networkPackages = ['undici', 'playwright', 'playwright-core'];
const databasePackages = ['pg', 'pg-boss', '@llms-txt/db'];
const ioBuiltins = [...networkBuiltins, 'fs'];
const ioPackages = [...networkPackages, ...databasePackages, '@llms-txt/crawler'];

/** Imports of the web app's `src/<layer>` folders, through the `@/` alias or a relative path. */
const webLayers = (/** @type {string[]} */ layers, /** @type {string} */ message) => ({
  regex: `^(@/|(\\.\\./)+)(${layers.join('|')})(/.*)?$`,
  message,
});
const NETWORK_MESSAGE = 'The crawler owns all fetching of target sites, behind the SSRF guard.';
const SQL_MESSAGE = 'SQL lives in @llms-txt/db; call its functions instead of importing pg.';
const CRAWLER_STORAGE_MESSAGE = 'The crawler returns what it fetched; the worker stores it.';
const BROWSER_MESSAGE = 'Browser code reaches the server only through the app\'s /api routes.';
const PG_PATTERN = { regex: '^pg(/.*)?$', message: SQL_MESSAGE };
const PURE_MESSAGE = 'Contracts and pure stages do not touch the database or the queue; the worker does.';
const DECISIONS_MESSAGE = 'Pipeline decisions are pure: a stage loads their inputs and saves what they return.';
const PIPELINE_WIRING_MESSAGE = 'The pipeline is handed its dependencies (pipeline-dependencies.ts); it does not import the worker\'s wiring.';

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

/** Which workspace packages each package may import. */
const packageDependencies = {
  contracts: [],
  runtime: [],
  crawler: ['contracts'],
  db: ['contracts'],
  extractor: ['contracts'],
  generator: ['contracts'],
  monitor: ['db'],
};
const WORKSPACE_PACKAGES = [...Object.keys(packageDependencies), 'web', 'worker'];
const ENTRY_POINT_PATTERN = {
  regex: '^@llms-txt/[^/]+/.+$',
  message: 'Import a package through its entry point (src/index.ts), never a file inside it.',
};
const LLM_SDK_PATTERN = {
  regex: '^@anthropic-ai/sdk(/.*)?$',
  message: 'Only the worker\'s llm/ folder uses the Anthropic SDK; the pipeline is handed an LlmClient.',
};

// A separate rule from `no-restricted-imports`, so these apply alongside each block above.
const packageBoundaries = (
  /** @type {string[]} */ allowedPackages,
  /** @type {{ mayUseLlmSdk?: boolean }} */ { mayUseLlmSdk = false } = {},
) => {
  const forbiddenPackages = WORKSPACE_PACKAGES.filter((name) => !allowedPackages.includes(name));
  return {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          ENTRY_POINT_PATTERN,
          {
            regex: `^@llms-txt/(${forbiddenPackages.join('|')})$`,
            message: 'This package may not depend on that one (packageDependencies in eslint.config.js).',
          },
          ...(mayUseLlmSdk ? [] : [LLM_SDK_PATTERN]),
        ],
      },
    ],
  };
};
const WORKER_DEPENDENCIES = Object.keys(packageDependencies);
const WEB_DEPENDENCIES = ['contracts', 'db', 'generator', 'runtime'];
const DETERMINISM_MESSAGE = 'Pure code takes the time or an id as an input, so equal inputs give equal output.';

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
  // Node scripts run by hand, outside the workspaces.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
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
    files: ['packages/crawler/src/network/**/*.ts'],
    rules: restrict([], databasePackages, CRAWLER_STORAGE_MESSAGE),
  },
  {
    files: ['packages/crawler/src/**/*.ts'],
    ignores: ['packages/crawler/src/network/**'],
    rules: restrict(networkBuiltins, networkPackages, 'Only the crawler\'s network/ folder opens connections, beside the SSRF guard.', [
      { regex: `^(${databasePackages.join('|')})(/.*)?$`, message: CRAWLER_STORAGE_MESSAGE },
    ]),
  },
  {
    files: ['packages/{monitor,runtime}/src/**/*.ts', 'apps/**/*.{ts,tsx}'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE, [PG_PATTERN]),
  },
  {
    files: ['packages/db/src/connection/**/*.ts'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE),
  },
  {
    files: ['packages/db/src/**/*.ts'],
    ignores: ['packages/db/src/connection/**'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE, [
      { regex: '^pg(/.*)?$', message: 'Only connection/ imports pg; queries take a Queryable from it.' },
    ]),
  },
  // The layers of the two apps. Each block repeats the apps' base restrictions above,
  // because a later `no-restricted-imports` replaces an earlier one.
  {
    files: ['apps/worker/src/pipeline/**/*.ts'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE, [
      PG_PATTERN,
      { regex: '^(\\.\\./)+(config|jobs|llm|main)(/.*)?$', message: PIPELINE_WIRING_MESSAGE },
    ]),
  },
  // Type imports from @llms-txt/db are allowed, which the core rule cannot express.
  {
    files: ['apps/worker/src/pipeline/decisions/**/*.ts'],
    rules: {
      ...restrict(ioBuiltins, [...networkPackages, 'pg', 'pg-boss', '@llms-txt/crawler'], DECISIONS_MESSAGE, [
        { regex: '^(\\.\\./)+(config|jobs|llm|main)(/.*)?$', message: PIPELINE_WIRING_MESSAGE },
        { regex: '^\\.\\./(stages|run-pipeline|run-pipeline-stages|pipeline-dependencies)(/.*)?$', message: DECISIONS_MESSAGE },
      ]),
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            ENTRY_POINT_PATTERN,
            LLM_SDK_PATTERN,
            { regex: '^@llms-txt/db$', allowTypeImports: true, message: DECISIONS_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/server/**/*.ts'],
    rules: restrict(networkBuiltins, networkPackages, NETWORK_MESSAGE, [
      PG_PATTERN,
      webLayers(['app', 'features', 'browser'], 'Server code shares only shared/ with the browser code.'),
    ]),
  },
  {
    files: ['apps/web/src/{features,browser}/**/*.{ts,tsx}'],
    rules: restrict(networkBuiltins, [...networkPackages, ...databasePackages], BROWSER_MESSAGE, [
      webLayers(['app', 'server'], BROWSER_MESSAGE),
    ]),
  },
  {
    files: ['apps/web/src/browser/**/*.ts'],
    rules: restrict(networkBuiltins, [...networkPackages, ...databasePackages], BROWSER_MESSAGE, [
      webLayers(['app', 'server', 'features'], 'browser/ holds the API client; components in features/ call it, not the reverse.'),
    ]),
  },
  {
    files: ['apps/web/src/shared/**/*.ts'],
    rules: restrict(networkBuiltins, [...networkPackages, ...databasePackages], BROWSER_MESSAGE, [
      webLayers(['app', 'server', 'features', 'browser'], 'shared/ is imported by both sides and imports neither.'),
    ]),
  },
  ...Object.entries(packageDependencies).map(([name, allowedPackages]) => ({
    files: [`packages/${name}/src/**/*.ts`],
    rules: packageBoundaries(allowedPackages),
  })),
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: packageBoundaries(WEB_DEPENDENCIES),
  },
  {
    files: ['apps/worker/src/**/*.ts'],
    ignores: ['apps/worker/src/pipeline/decisions/**', 'apps/worker/src/llm/**'],
    rules: packageBoundaries(WORKER_DEPENDENCIES),
  },
  {
    files: ['apps/worker/src/llm/**/*.ts'],
    rules: packageBoundaries(WORKER_DEPENDENCIES, { mayUseLlmSdk: true }),
  },
  {
    files: ['packages/{extractor,generator}/src/**/*.ts', 'apps/worker/src/pipeline/decisions/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: DETERMINISM_MESSAGE },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: DETERMINISM_MESSAGE },
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: DETERMINISM_MESSAGE },
        { selector: "CallExpression[callee.name='randomUUID']", message: DETERMINISM_MESSAGE },
        { selector: "CallExpression[callee.property.name='randomUUID']", message: DETERMINISM_MESSAGE },
      ],
    },
  },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/worker/src/config/**', 'apps/web/src/server/composition/web-config.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read the environment in the config modules (worker-config.ts, web-config.ts).' },
      ],
    },
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
