import type { GeneratorPage } from '@llms-txt/contracts';
import {
  loadExcludedUrlPrefixes,
  loadGeneratorPages,
  loadLatestPipelineRunSummary,
  loadNewestVersion,
  loadSiteForRun,
  loadWorkspaceOverrides,
  publishLlmsTxtVersion,
  replaceExcludedPages,
  replaceExcludedUrlPrefixes,
  withTransaction,
  type DatabasePool,
  type WorkspaceAccess,
} from '@llms-txt/db';
import {
  decidePublication,
  excludePagesUnderUrlPrefixes,
  generateLlmsTxt,
  listingCandidates,
  selectPages,
  siteNameFrom,
} from '@llms-txt/generator';
import type { SaveExclusionsResult, WorkspaceExclusions, WorkspacePagesView } from '../shared/workspace-pages';

/** More pages than any crawl stores for one site, and more paths than a site has areas. */
const MAX_EXCLUDED_URLS = 5_000;
const MAX_EXCLUDED_URL_PREFIXES = 500;
const MAX_URL_LENGTH = 2_048;

/**
 * A request body as the exclusions it asks for, or null if it is not well formed. Each
 * prefix is stored as scheme, host and path with no trailing slash, query or fragment.
 */
export function parseWorkspaceExclusions(body: unknown): WorkspaceExclusions | null {
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
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/** The site's crawled pages, with what this workspace ignores and where each page is listed. */
export async function loadWorkspacePagesView(
  workspace: WorkspaceAccess,
  dependencies: { databasePool: DatabasePool },
): Promise<WorkspacePagesView> {
  const [loadedPages, overrides, excludedUrlPrefixes] = await Promise.all([
    loadGeneratorPages(dependencies.databasePool, workspace.siteId),
    loadWorkspaceOverrides(dependencies.databasePool, workspace.id),
    loadExcludedUrlPrefixes(dependencies.databasePool, workspace.id),
  ]);
  const excludedUrls = new Set(overrides.filter((override) => override.isExcluded).map((override) => override.normalisedUrl));
  const sectionNameByUrl = new Map(
    selectPages(
      pagesTheWorkerRenders(loadedPages),
      excludePagesUnderUrlPrefixes(overrides, excludedUrlPrefixes, loadedPages),
    ).map((selected) => [selected.page.record.normalisedUrl, selected.sectionName]),
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
 * Saves the pages and paths the workspace ignores and renders its file again from the
 * stored crawl, with no fetch and no LLM call, so the change shows at once as a
 * `user_edit` version. While a run is active, or before the first version, the choices
 * are only saved: the run renders every workspace as its last step and applies them.
 */
export async function saveWorkspaceExclusions(
  workspace: WorkspaceAccess,
  exclusions: WorkspaceExclusions,
  dependencies: { databasePool: DatabasePool },
): Promise<SaveExclusionsResult> {
  const { databasePool } = dependencies;
  await withTransaction(databasePool, async (transaction) => {
    await replaceExcludedPages(transaction, workspace, exclusions.excludedUrls);
    await replaceExcludedUrlPrefixes(transaction, workspace.id, exclusions.excludedUrlPrefixes);
  });

  const [latestRun, newestVersion] = await Promise.all([
    loadLatestPipelineRunSummary(databasePool, workspace.siteId),
    loadNewestVersion(databasePool, workspace.id),
  ]);
  const isRunActive = latestRun?.status === 'queued' || latestRun?.status === 'running';
  if (isRunActive || newestVersion === null) return { kind: 'applied_by_next_run' };

  const [site, loadedPages, overrides, excludedUrlPrefixes] = await Promise.all([
    loadSiteForRun(databasePool, workspace.siteId),
    loadGeneratorPages(databasePool, workspace.siteId),
    loadWorkspaceOverrides(databasePool, workspace.id),
    loadExcludedUrlPrefixes(databasePool, workspace.id),
  ]);
  const rendered = generateLlmsTxt({
    siteTitle: siteNameFrom(site.siteTitle ?? new URL(site.rootUrl).host, loadedPages),
    siteSummary: site.generatedSummary,
    siteNotes: site.generatedNotes,
    machineReadableResourceUrls: site.machineReadableResourceUrls,
    pages: pagesTheWorkerRenders(loadedPages),
    overrides: excludePagesUnderUrlPrefixes(overrides, excludedUrlPrefixes, loadedPages),
  });
  const decision = decidePublication(newestVersion.llmsTxtContent, rendered);
  if (decision.kind === 'unchanged') return { kind: 'unchanged' };

  const version = await withTransaction(databasePool, (transaction) =>
    publishLlmsTxtVersion(transaction, {
      workspaceId: workspace.id,
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

/**
 * The worker leaves out candidate pages the LLM has not assessed yet
 * (llm-enrichment-stage.ts). Whether it has an LLM is not known here, so a site with any
 * assessment is taken to be assessed.
 */
function pagesTheWorkerRenders(pages: GeneratorPage[]): GeneratorPage[] {
  if (!pages.some((page) => page.assessment !== null)) return pages;
  const unassessedCandidateUrls = new Set(
    listingCandidates(pages).filter((page) => page.assessment === null).map((page) => page.record.normalisedUrl),
  );
  return pages.filter((page) => !unassessedCandidateUrls.has(page.record.normalisedUrl));
}
