// The OpenAPI description of the REST API, served at /api/openapi.json and shown by
// Swagger UI on /api-docs. It is written by hand beside the routes; openapi-document.test.ts
// fails if a route and this document stop listing the same paths and methods.

type JsonSchema = Record<string, unknown>;

const reference = (schemaName: string): JsonSchema => ({ $ref: `#/components/schemas/${schemaName}` });
const nullable = (type: string, extra: JsonSchema = {}): JsonSchema => ({ type: [type, 'null'], ...extra });
const nullableReference = (schemaName: string): JsonSchema => ({ oneOf: [reference(schemaName), { type: 'null' }] });
const dateTime: JsonSchema = { type: 'string', format: 'date-time' };
const nullableDateTime = nullable('string', { format: 'date-time' });
const count: JsonSchema = { type: 'integer', minimum: 0 };
const positiveInteger: JsonSchema = { type: 'integer', minimum: 1 };
const urlList: JsonSchema = { type: 'array', items: { type: 'string', format: 'uri' } };

/** An object schema in which every property is always present. */
const objectOf = (properties: Record<string, JsonSchema>, extra: JsonSchema = {}): JsonSchema => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
  ...extra,
});

const jsonContent = (schema: JsonSchema) => ({ 'application/json': { schema } });
const jsonResponse = (description: string, schema: JsonSchema, headers?: Record<string, unknown>) => ({
  description,
  ...(headers ? { headers } : {}),
  content: jsonContent(schema),
});
const errorResponse = (description: string) => jsonResponse(description, reference('ApiError'));
const llmsTxtResponse = {
  description: 'The file, as text.',
  headers: {
    'X-Llms-Txt-Version': { description: 'The version number of this file.', schema: positiveInteger },
  },
  content: { 'text/plain': { schema: { type: 'string' } } },
};
const locationHeader = { Location: { description: 'The run to poll.', schema: { type: 'string' } } };
const retryAfterHeader = { 'Retry-After': { description: 'Seconds to wait.', schema: count } };

const publicSlugParameter = {
  name: 'publicSlug',
  in: 'path',
  required: true,
  description: "The site's slug, from the response to submitting it.",
  schema: { type: 'string' },
};
const pipelineRunIdParameter = {
  name: 'pipelineRunId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const versionNumberParameter = { name: 'versionNumber', in: 'path', required: true, schema: positiveInteger };

const unauthorised = { $ref: '#/components/responses/Unauthorized' };
const internalError = { $ref: '#/components/responses/InternalError' };
const siteNotFound = errorResponse('`site_not_found`: there is no site at this slug.');

const schemas: Record<string, JsonSchema> = {
  ApiError: objectOf(
    {
      error: { type: 'string', description: 'A message for people.' },
      code: {
        type: 'string',
        description: 'A stable code for programs.',
        enum: [
          'cooldown_active',
          'internal_error',
          'invalid_request',
          'invalid_url',
          'invalid_version_number',
          'run_in_progress',
          'run_not_found',
          'run_produced_no_version',
          'site_not_found',
          'unauthorized',
          'version_not_found',
        ],
      },
    },
  ),
  CooldownError: {
    allOf: [reference('ApiError'), objectOf({ retryAfterSeconds: count })],
  },
  SubmitSiteRequest: objectOf({ url: { type: 'string', format: 'uri', examples: ['https://example.com'] } }),
  SubmittedSite: objectOf({
    publicSlug: { type: 'string' },
    pipelineRunId: { type: 'string', format: 'uuid' },
    runUrl: { type: 'string', description: 'The API path to poll.' },
    llmsTxtUrl: { type: 'string', description: 'The path of the hosted file.' },
  }),
  StartedRun: objectOf({
    pipelineRunId: { type: 'string', format: 'uuid' },
    joinedActiveRun: { type: 'boolean', description: 'True when this is a run that was already in progress.' },
    runUrl: { type: 'string', description: 'The API path to poll.' },
  }),
  PipelineRun: objectOf({
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'unchanged', 'failed'] },
    currentStage: { enum: ['crawl', 'extract', 'generate', null] },
    triggeredBy: { type: 'string', enum: ['submission', 'monitor', 'user_check_now'] },
    errorMessage: nullable('string'),
    createdAt: dateTime,
    startedAt: nullableDateTime,
    finishedAt: nullableDateTime,
    pagesDiscoveredCount: count,
    pagesFetchedCount: count,
    pagesChangedCount: count,
    pagesFailedCount: count,
  }),
  PipelineRunDetail: {
    allOf: [
      reference('PipelineRun'),
      objectOf({
        versionNumber: nullable('integer', {
          description: 'The version this run published. Null while active, or if it changed nothing or failed.',
        }),
        llmsTxtUrl: nullable('string', { description: "Where to get that version's text." }),
      }),
    ],
  },
  VersionSummary: objectOf({
    versionNumber: positiveInteger,
    listedPageCount: count,
    addedPageCount: count,
    removedPageCount: count,
    changedPageCount: count,
    createdBy: { type: 'string', enum: ['pipeline', 'user_edit'] },
    createdAt: dateTime,
  }),
  VersionContent: objectOf({ versionNumber: positiveInteger, llmsTxtContent: { type: 'string' } }),
  PublishedVersion: objectOf({
    versionNumber: positiveInteger,
    llmsTxtContent: { type: 'string' },
    listedPageCount: count,
    createdAt: dateTime,
    validation: objectOf({
      isValid: { type: 'boolean' },
      problems: { type: 'array', items: { type: 'string' } },
    }),
  }),
  Site: objectOf({
    publicSlug: { type: 'string' },
    rootUrl: { type: 'string', format: 'uri' },
    siteTitle: nullable('string'),
    hostedLlmsTxtPath: { type: 'string', description: "The hosted file's path on this app." },
    monitoring: objectOf({ nextCheckAt: nullableDateTime }),
    latestRun: nullableReference('PipelineRun'),
    publishedVersion: nullableReference('PublishedVersion'),
    isPublishedVersionPinned: {
      type: 'boolean',
      description: 'True when the user chose the live version, so new versions do not go live.',
    },
    versions: { type: 'array', description: 'Newest first.', items: reference('VersionSummary') },
  }),
  PinVersionRequest: objectOf({ versionNumber: positiveInteger }),
  PinnedVersion: objectOf({ versionNumber: positiveInteger, isPinned: { const: true } }),
  SitePage: objectOf({
    normalisedUrl: { type: 'string', format: 'uri' },
    title: nullable('string'),
    isHomepage: { type: 'boolean', description: "The crawl root: the file's H1, so it cannot be ignored." },
    isExcluded: { type: 'boolean', description: 'The user ignores this page by itself.' },
    listedInSection: nullable('string', { description: 'The section the page is listed under, if any.' }),
  }),
  SitePages: objectOf({
    pages: { type: 'array', items: reference('SitePage') },
    excludedUrlPrefixes: { ...urlList, description: 'Ignored paths, as URL prefixes with no trailing slash.' },
  }),
  PageExclusions: objectOf({
    excludedUrls: { ...urlList, description: 'Pages ignored one by one.' },
    excludedUrlPrefixes: {
      ...urlList,
      description: 'Every page at or under these is left out, including pages found by later crawls.',
      examples: [['https://example.com/blog']],
    },
  }),
  SaveExclusionsResult: {
    oneOf: [
      objectOf({
        kind: { const: 'published', description: 'The file changed and this version was recorded.' },
        versionNumber: positiveInteger,
        isLive: { type: 'boolean', description: 'False when another version is pinned.' },
      }),
      objectOf({ kind: { const: 'unchanged', description: 'The choices were saved and the file reads the same.' } }),
      objectOf({
        kind: {
          const: 'applied_by_next_run',
          description: 'A run is active or nothing has been generated yet, so the next run applies the choices.',
        },
      }),
    ],
  },
};

const sitesTag = 'Sites';
const runsTag = 'Runs';
const versionsTag = 'Versions';
const pagesTag = 'Pages';
const hostedFileTag = 'Hosted file';

const paths = {
  '/api/sites': {
    post: {
      tags: [sitesTag],
      operationId: 'submitSite',
      summary: 'Submit a site',
      requestBody: { required: true, content: jsonContent(reference('SubmitSiteRequest')) },
      responses: {
        202: jsonResponse('The site was saved and its run queued.', reference('SubmittedSite'), locationHeader),
        400: errorResponse('`invalid_request` or `invalid_url`.'),
        401: unauthorised,
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}': {
    parameters: [publicSlugParameter],
    get: {
      tags: [sitesTag],
      operationId: 'getSite',
      summary: 'Get a site',
      responses: {
        200: jsonResponse('The site, its latest run and its versions.', reference('Site')),
        401: unauthorised,
        404: siteNotFound,
        500: internalError,
      },
    },
    delete: {
      tags: [sitesTag],
      operationId: 'deleteSite',
      summary: 'Delete a site',
      description: 'Deletes its file, hosted URL, crawl data, overrides and version history.',
      responses: { 204: { description: 'Deleted.' }, 401: unauthorised, 404: siteNotFound, 500: internalError },
    },
  },
  '/api/sites/{publicSlug}/runs': {
    parameters: [publicSlugParameter],
    post: {
      tags: [runsTag],
      operationId: 'startRun',
      summary: 'Re-trigger a site',
      description: 'During a run, this returns that run. Within the cooldown after the last run, it answers 429.',
      responses: {
        202: jsonResponse('The run to poll.', reference('StartedRun'), locationHeader),
        401: unauthorised,
        404: siteNotFound,
        429: jsonResponse('`cooldown_active`.', reference('CooldownError'), retryAfterHeader),
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/runs/{pipelineRunId}': {
    parameters: [publicSlugParameter, pipelineRunIdParameter],
    get: {
      tags: [runsTag],
      operationId: 'getRun',
      summary: "Check a run's status",
      responses: {
        200: jsonResponse(
          'The run. While it is active, `Retry-After` says when to poll again.',
          reference('PipelineRunDetail'),
          retryAfterHeader,
        ),
        401: unauthorised,
        404: errorResponse('`site_not_found` or `run_not_found`.'),
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/runs/{pipelineRunId}/llms.txt': {
    parameters: [publicSlugParameter, pipelineRunIdParameter],
    get: {
      tags: [runsTag],
      operationId: 'getRunFile',
      summary: 'Get the file a run published',
      responses: {
        200: llmsTxtResponse,
        401: unauthorised,
        404: errorResponse('`site_not_found`, `run_not_found` or `run_produced_no_version`.'),
        409: jsonResponse('`run_in_progress`.', reference('ApiError'), retryAfterHeader),
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/versions': {
    parameters: [publicSlugParameter],
    get: {
      tags: [versionsTag],
      operationId: 'listVersions',
      summary: 'List versions',
      responses: {
        200: jsonResponse('Newest first, without the file contents.', {
          type: 'array',
          items: reference('VersionSummary'),
        }),
        401: unauthorised,
        404: siteNotFound,
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/versions/{versionNumber}': {
    parameters: [publicSlugParameter, versionNumberParameter],
    get: {
      tags: [versionsTag],
      operationId: 'getVersion',
      summary: 'Get a version as JSON',
      responses: {
        200: jsonResponse('The version.', reference('VersionContent')),
        401: unauthorised,
        404: errorResponse('`site_not_found` or `version_not_found`.'),
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/versions/{versionNumber}/llms.txt': {
    parameters: [publicSlugParameter, versionNumberParameter],
    get: {
      tags: [versionsTag],
      operationId: 'getVersionFile',
      summary: 'Get a version as text',
      responses: {
        200: llmsTxtResponse,
        401: unauthorised,
        404: errorResponse('`site_not_found` or `version_not_found`.'),
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/published-version': {
    parameters: [publicSlugParameter],
    put: {
      tags: [versionsTag],
      operationId: 'pinVersion',
      summary: 'Pin a version',
      description: 'Makes this version live. Later checks record new versions without publishing them.',
      requestBody: { required: true, content: jsonContent(reference('PinVersionRequest')) },
      responses: {
        200: jsonResponse('The version is live and pinned.', reference('PinnedVersion')),
        400: errorResponse('`invalid_version_number`.'),
        401: unauthorised,
        404: errorResponse('`site_not_found` or `version_not_found`.'),
        500: internalError,
      },
    },
    delete: {
      tags: [versionsTag],
      operationId: 'unpinVersion',
      summary: 'Follow the latest version',
      responses: {
        204: { description: 'The newest version is live again.' },
        401: unauthorised,
        404: siteNotFound,
        500: internalError,
      },
    },
  },
  '/api/sites/{publicSlug}/pages': {
    parameters: [publicSlugParameter],
    get: {
      tags: [pagesTag],
      operationId: 'listPages',
      summary: 'List crawled pages and what is ignored',
      responses: {
        200: jsonResponse('The pages and the ignored paths.', reference('SitePages')),
        401: unauthorised,
        404: siteNotFound,
        500: internalError,
      },
    },
    put: {
      tags: [pagesTag],
      operationId: 'setIgnoredPages',
      summary: 'Set the ignored pages and paths',
      description: 'Replaces everything that is ignored and renders the file again.',
      requestBody: { required: true, content: jsonContent(reference('PageExclusions')) },
      responses: {
        200: jsonResponse('What saving did to the file.', reference('SaveExclusionsResult')),
        400: errorResponse('`invalid_request`.'),
        401: unauthorised,
        404: siteNotFound,
        500: internalError,
      },
    },
  },
  '/w/{publicSlug}/llms.txt': {
    parameters: [publicSlugParameter],
    get: {
      tags: [hostedFileTag],
      operationId: 'getHostedFile',
      summary: 'Get the live file',
      description: 'Public, so sites can proxy or redirect their /llms.txt to it.',
      security: [],
      responses: {
        200: { description: 'The file, as text.', content: { 'text/plain': { schema: { type: 'string' } } } },
        404: {
          description: 'There is no published file at this slug.',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
      },
    },
  },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'llms.txt generator API',
    version: '1.0.0',
    description:
      'Generate an llms.txt for a website and keep it up to date. Every endpoint needs HTTP Basic auth, or the ' +
      "web app's sign-in cookie, except the live file.",
  },
  tags: [sitesTag, runsTag, versionsTag, pagesTag, hostedFileTag].map((name) => ({ name })),
  security: [{ basicAuth: [] }],
  paths,
  components: {
    securitySchemes: { basicAuth: { type: 'http', scheme: 'basic' } },
    responses: {
      Unauthorized: errorResponse('`unauthorized`: the login is missing or wrong.'),
      InternalError: errorResponse('`internal_error`.'),
    },
    schemas,
  },
};
