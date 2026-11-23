// Renders the llms.txt of sites again from the pages already stored for them: no crawl, no
// run and no new version. The hub eval uses it to score a change to the generator against
// the same crawl as the last one (evals/hub/README.md). Pages whose assessment inputs
// changed are assessed again, and the results are saved as in a run.
//
//   tsx --env-file=../../.env src/render-stored-sites.ts <output directory> <public slug>...
//
// Writes `<host>.txt` for each site that has something to list.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDatabasePool, loadGeneratorPages, loadSiteForRun, loadSiteIdBySlug, type DatabasePool } from '@llms-txt/db';
import { generateLlmsTxt, selectPages, siteNameFrom, type LlmClient } from '@llms-txt/generator';
import { createLogger, type Logger } from '@llms-txt/runtime';
import { readWorkerConfig } from './config/worker-config';
import { createAnthropicLlmClient } from './llm/anthropic-llm-client';
import { createStubLlmClient } from './llm/stub-llm-client';
import { enrichPagesWithLlm } from './pipeline/stages/llm-enrichment';

const CONCURRENT_SITES = 3;

interface RenderDependencies {
  databasePool: DatabasePool;
  logger: Logger;
  llmClient: LlmClient;
}

/** The file for one site, or null when it has no page to list. */
async function renderStoredSite(publicSlug: string, { databasePool, logger, llmClient }: RenderDependencies) {
  const siteId = await loadSiteIdBySlug(databasePool, publicSlug);
  if (siteId === null) throw new Error(`there is no site with the slug ${publicSlug}`);
  const site = await loadSiteForRun(databasePool, siteId);
  const host = new URL(site.rootUrl).host;
  const loadedPages = await loadGeneratorPages(databasePool, siteId);
  const siteTitle = siteNameFrom(site.siteTitle ?? host, loadedPages);
  const { pages, siteSummary, siteNotes, siteName } = await enrichPagesWithLlm({
    databasePool,
    logger: logger.child({ host }),
    llmClient,
    site,
    siteTitle,
    pages: loadedPages,
  });
  if (selectPages(pages, []).length === 0) return { host, llmsTxt: null };
  const llmsTxt = generateLlmsTxt({
    siteTitle,
    siteName,
    siteSummary,
    siteNotes,
    machineReadableResourceUrls: site.machineReadableResourceUrls,
    pages,
    overrides: [],
  });
  return { host, llmsTxt };
}

const [outputDirectory, ...publicSlugs] = process.argv.slice(2);
if (outputDirectory === undefined || publicSlugs.length === 0) {
  throw new Error('usage: render-stored-sites.ts <output directory> <public slug>...');
}
const config = readWorkerConfig();
const dependencies: RenderDependencies = {
  databasePool: createDatabasePool(config.databaseUrl),
  logger: createLogger({ level: 'warn', fields: { process: 'render-stored-sites' } }),
  llmClient: config.llmClient.kind === 'stub' ? createStubLlmClient() : createAnthropicLlmClient(config.llmClient.apiKey),
};
await mkdir(outputDirectory, { recursive: true });

const queue = [...publicSlugs];
const renderQueued = async (): Promise<void> => {
  for (let publicSlug = queue.shift(); publicSlug !== undefined; publicSlug = queue.shift()) {
    const { host, llmsTxt } = await renderStoredSite(publicSlug, dependencies);
    if (llmsTxt !== null) await writeFile(path.join(outputDirectory, `${host}.txt`), llmsTxt);
    process.stdout.write(`${host}: ${llmsTxt === null ? 'nothing to list' : `${llmsTxt.split('\n').filter((line) => line.startsWith('- [')).length} entries`}\n`);
  }
};
await Promise.all(Array.from({ length: CONCURRENT_SITES }, renderQueued));
await dependencies.databasePool.end();
