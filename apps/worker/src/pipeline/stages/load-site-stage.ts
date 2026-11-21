import type { PipelineRunJob } from '@llms-txt/contracts';
import { adoptResolvedSiteRoot, loadSiteForRun, loadStoredPages, withTransaction, type SiteForRun, type StoredPage } from '@llms-txt/db';
import type { PipelineStageDependencies } from '../pipeline-dependencies';

/** The site a run works on and the pages stored for it, or the news that another run has taken the site over. */
export type LoadedSite =
  | { kind: 'loaded'; site: SiteForRun; storedPages: StoredPage[] }
  /** The site's resolved root belongs to a site with an active run, whose last step picks up the workspaces just moved to it. */
  | { kind: 'merged_into_active_run' };

/**
 * Loads the run's site. A site's first crawl settles where it really lives, so
 * example.com and www.example.com are one row. A site with pages keeps its root: see
 * section 10, "Redirects".
 */
export async function loadSiteStage(job: PipelineRunJob, dependencies: PipelineStageDependencies): Promise<LoadedSite> {
  const { databasePool, logger } = dependencies;
  const site = await loadSiteForRun(databasePool, job.siteId);
  const storedPages = await loadStoredPages(databasePool, site.id);
  if (storedPages.length > 0) return { kind: 'loaded', site, storedPages };

  const resolvedRootUrl = await dependencies.resolveRootUrl(site.rootUrl);
  if (resolvedRootUrl === site.rootUrl) return { kind: 'loaded', site, storedPages };

  const adoption = await withTransaction(databasePool, (transaction) =>
    adoptResolvedSiteRoot(transaction, { siteId: site.id, pipelineRunId: job.pipelineRunId, resolvedRootUrl }),
  );
  logger.info('site root resolved', { resolvedRootUrl, adoption: adoption.kind });
  if (adoption.kind === 'merged_into_active_run') return { kind: 'merged_into_active_run' };
  const adoptedSite = await loadSiteForRun(databasePool, adoption.siteId);
  return { kind: 'loaded', site: adoptedSite, storedPages: await loadStoredPages(databasePool, adoptedSite.id) };
}
