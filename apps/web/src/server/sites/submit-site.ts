import { randomBytes } from 'node:crypto';
import {
  createSite,
  isUniqueViolation,
  loadOwnedSiteSlugByUrl,
  scheduleSiteMonitoring,
  startPipelineRun,
  withTransaction,
  type DatabasePool,
  type PipelineRunQueue,
} from '@llms-txt/db';
import { normaliseSubmittedUrl } from './normalise-submitted-url';

export interface SubmitSiteDependencies {
  databasePool: DatabasePool;
  queue: PipelineRunQueue;
}

export interface SubmitSiteRequest {
  /** The signed-in user, who will own the site. */
  ownerUserId: string;
  submittedUrl: string;
}

export type SubmitSiteOutcome =
  | {
      kind: 'submitted';
      publicSlug: string;
      pipelineRunId: string;
    }
  | { kind: 'invalid_url' }
  /** The user already has a site for this URL: the slug is that site's. */
  | { kind: 'already_exists'; publicSlug: string };

/**
 * A URL submission: in one transaction create a new site with monitoring on and start
 * its first run, owned by the user who submitted it. A user has one site per URL: a URL
 * they have already submitted is refused, and the answer names the site they have.
 */
export async function submitSite(
  request: SubmitSiteRequest,
  dependencies: SubmitSiteDependencies,
): Promise<SubmitSiteOutcome> {
  const rootUrl = normaliseSubmittedUrl(request.submittedUrl);
  if (rootUrl === null) return { kind: 'invalid_url' };

  const publicSlug = randomBytes(12).toString('base64url');
  try {
    return await createSiteAndFirstRun({ ownerUserId: request.ownerUserId, rootUrl, publicSlug }, dependencies);
  } catch (error) {
    // The unique indexes decide, not a lookup first, so two submissions at once cannot both pass.
    if (!isUniqueViolation(error)) throw error;
    const existingSlug = await loadOwnedSiteSlugByUrl(dependencies.databasePool, request.ownerUserId, rootUrl);
    if (existingSlug === null) throw error;
    return { kind: 'already_exists', publicSlug: existingSlug };
  }
}

function createSiteAndFirstRun(
  site: { ownerUserId: string; rootUrl: string; publicSlug: string },
  dependencies: SubmitSiteDependencies,
): Promise<SubmitSiteOutcome> {
  const { publicSlug } = site;
  return withTransaction(dependencies.databasePool, async (transaction) => {
    const siteId = await createSite(transaction, site);
    await scheduleSiteMonitoring(transaction, siteId);
    const run = await startPipelineRun(transaction, dependencies.queue, { siteId, triggeredBy: 'submission' });
    // The site was created in this transaction, so nothing else can have a run on it.
    if (run.kind !== 'started') throw new Error(`new site ${siteId} already had an active run`);
    return { kind: 'submitted', publicSlug, pipelineRunId: run.pipelineRunId };
  });
}
