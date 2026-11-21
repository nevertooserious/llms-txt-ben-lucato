import {
  loadExcludedUrlPrefixes,
  loadGeneratorPages,
  loadLatestPipelineRunSummary,
  loadNewestVersion,
  loadPageOverrides,
  loadSiteForRun,
  publishLlmsTxtVersion,
  replaceExcludedPages,
  replaceExcludedUrlPrefixes,
  withTransaction,
  type DatabasePool,
} from '@llms-txt/db';
import {
  decidePublication,
  excludePagesUnderUrlPrefixes,
  generateLlmsTxt,
  selectPages,
  siteNameFrom,
} from '@llms-txt/generator';
import type { PageExclusions, SaveExclusionsResult, SitePagesView } from '@/shared/site-pages';
import { isActiveRunStatus } from '@/shared/site-view';

/** More pages than any crawl stores for one site, and more paths than a site has areas. */
const MAX_EXCLUDED_URLS = 5_000;
const MAX_EXCLUDED_URL_PREFIXES = 500;
const MAX_URL_LENGTH = 2_048;

/**
 * A request body as the exclusions it asks for, or null if it is not well formed. Each
 * prefix is stored as scheme, host and path with no trailing slash, query or fragment.
 */
export function parsePageExclusions(body: unknown): PageExclusions | null {
  if (typeof body !== 'object' || body === null) return null;
  const { excludedUrls, excludedUrlPrefixes } = body as { excludedUrls?: unknown; excludedUrlPrefixes?: unknown };
  if (!isListOfUrls(excludedUrls, MAX_EXCLUDED_URLS) || !isListOfUrls(excludedUrlPrefixes, MAX_EXCLUDED_URL_PREFIXES)) {
    return null;
  }
  const normalisedPrefixes = excludedUrlPrefixes.map(normaliseUrlPrefix);
  if (normalisedPrefixes.some((urlPrefix) => urlPrefix === null)) return null;
  return { excludedUrls, excludedUrlPrefixes: [...new Set(normalisedPrefixes as string[])] };
}

function isListOfUrls(value: unknown, maximumLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumLength &&
    value.every((url) => typeof url === 'string' && url.length <= MAX_URL_LENGTH)
  );
}

function normaliseUrlPrefix(urlPrefix: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlPrefix);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // Parsing percent-encodes, so the stored form can be far longer than what was sent.
  const normalised = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return normalised.length <= MAX_URL_LENGTH ? normalised : null;
}

/** The site's crawled pages, with what the user ignores and where each page is listed. */
export async function loadSitePagesView(
  siteId: string,
  dependencies: { databasePool: DatabasePool },
): Promise<SitePagesView> {
  const [loadedPages, overrides, excludedUrlPrefixes] = await Promise.all([
    loadGeneratorPages(dependencies.databasePool, siteId),
    loadPageOverrides(dependencies.databasePool, siteId),
    loadExcludedUrlPrefixes(dependencies.databasePool, siteId),
  ]);
  const excludedUrls = new Set(overrides.filter((override) => override.isExcluded).map((override) => override.normalisedUrl));
  const sectionNameByUrl = new Map(
    selectPages(loadedPages, excludePagesUnderUrlPrefixes(overrides, excludedUrlPrefixes, loadedPages)).map((selected) => [selected.page.record.normalisedUrl, selected.sectionName]),
  );
  return {
    pages: loadedPages.map((page) => ({
      normalisedUrl: page.record.normalisedUrl,
      title: page.record.title,
      isHomepage: page.crawlSignals.crawlDepth === 0,
      isExcluded: excludedUrls.has(page.record.normalisedUrl),
      listedInSection: sectionNameByUrl.get(page.record.normalisedUrl) ?? null,
    })),
    excludedUrlPrefixes,
  };
}

/**
 * Saves the pages and paths the user ignores and renders the file again from the stored
 * crawl, with no fetch and no LLM call, so the change shows at once as a `user_edit`
 * version. While a run is active, or before the first version, the choices are only
 * saved: the run renders the file as its last step and applies them.
 */
export async function savePageExclusions(
  siteId: string,
  exclusions: PageExclusions,
  dependencies: { databasePool: DatabasePool },
): Promise<SaveExclusionsResult> {
  const { databasePool } = dependencies;
  await withTransaction(databasePool, async (transaction) => {
    await replaceExcludedPages(transaction, siteId, exclusions.excludedUrls);
    await replaceExcludedUrlPrefixes(transaction, siteId, exclusions.excludedUrlPrefixes);
  });

  const [latestRun, newestVersion] = await Promise.all([
    loadLatestPipelineRunSummary(databasePool, siteId),
    loadNewestVersion(databasePool, siteId),
  ]);
  const isRunActive = latestRun !== null && isActiveRunStatus(latestRun.status);
  if (isRunActive || newestVersion === null) return { kind: 'applied_by_next_run' };

  const [site, loadedPages, overrides, excludedUrlPrefixes] = await Promise.all([
    loadSiteForRun(databasePool, siteId),
    loadGeneratorPages(databasePool, siteId),
    loadPageOverrides(databasePool, siteId),
    loadExcludedUrlPrefixes(databasePool, siteId),
  ]);
  // A site crawled before pages were always assessed would render with nothing listed.
  if (!loadedPages.some((page) => page.assessment !== null)) return { kind: 'applied_by_next_run' };
  const rendered = generateLlmsTxt({
    siteTitle: siteNameFrom(site.siteTitle ?? new URL(site.rootUrl).host, loadedPages),
    siteSummary: site.generatedSummary,
    siteNotes: site.generatedNotes,
    machineReadableResourceUrls: site.machineReadableResourceUrls,
    pages: loadedPages,
    overrides: excludePagesUnderUrlPrefixes(overrides, excludedUrlPrefixes, loadedPages),
  });
  const decision = decidePublication(newestVersion.llmsTxtContent, rendered);
  if (decision.kind === 'unchanged') return { kind: 'unchanged' };

  const version = await withTransaction(databasePool, (transaction) =>
    publishLlmsTxtVersion(transaction, {
      siteId,
      pipelineRunId: null,
      createdBy: 'user_edit',
      llmsTxtContent: decision.llmsTxtContent,
      llmsTxtContentHash: decision.llmsTxtContentHash,
      listedPageCount: decision.listedPageCount,
      pageChanges: decision.pageChanges,
    }),
  );
  if (version === null) return { kind: 'unchanged' };
  return { kind: 'published', versionNumber: version.versionNumber, isLive: version.isLive };
}
