import type { PipelineRunJob } from '@llms-txt/contracts';
import { loadSiteForRun, loadStoredPages, saveResolvedRootUrl, type SiteForRun, type StoredPage } from '@llms-txt/db';
import type { PipelineStageDependencies } from '../pipeline-dependencies';
import { PipelineRunFailure } from '../pipeline-run-failure';

/** The site a run works on and the pages stored for it. */
export interface LoadedSite {
  site: SiteForRun;
  storedPages: StoredPage[];
}

/**
 * Loads the run's site. A site's first crawl settles where it really lives, and fails if
 * that is a site its owner already has. A site with pages keeps its root: see section 10,
 * "Redirects".
 */
export async function loadSiteStage(job: PipelineRunJob, dependencies: PipelineStageDependencies): Promise<LoadedSite> {
  const { databasePool, logger } = dependencies;
  const site = await loadSiteForRun(databasePool, job.siteId);
  const storedPages = await loadStoredPages(databasePool, site.id);
  if (storedPages.length > 0) return { site, storedPages };

  const resolvedRootUrl = await dependencies.resolveRootUrl(site.rootUrl);
  if (resolvedRootUrl === site.rootUrl) return { site, storedPages };

  if (!(await saveResolvedRootUrl(databasePool, site.id, resolvedRootUrl))) {
    throw new PipelineRunFailure(`This address redirects to ${resolvedRootUrl}, which you already have a site for.`);
  }
  logger.info('site root resolved', { resolvedRootUrl });
  return { site: await loadSiteForRun(databasePool, site.id), storedPages };
}
