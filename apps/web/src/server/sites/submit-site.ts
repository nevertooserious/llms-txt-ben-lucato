import { randomBytes } from 'node:crypto';
import {
  createSite,
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
  | { kind: 'invalid_url' };

/**
 * A URL submission: in one transaction create a new site with monitoring on and start
 * its first run. Each submission is an independent site owned by the user who made it,
 * even for a URL submitted before.
 */
export async function submitSite(
  request: SubmitSiteRequest,
  dependencies: SubmitSiteDependencies,
): Promise<SubmitSiteOutcome> {
  const rootUrl = normaliseSubmittedUrl(request.submittedUrl);
  if (rootUrl === null) return { kind: 'invalid_url' };

  const publicSlug = randomBytes(12).toString('base64url');
  return withTransaction(dependencies.databasePool, async (transaction) => {
    const siteId = await createSite(transaction, { ownerUserId: request.ownerUserId, rootUrl, publicSlug });
    await scheduleSiteMonitoring(transaction, siteId);
    const run = await startPipelineRun(transaction, dependencies.queue, { siteId, triggeredBy: 'submission' });
    // The site was created in this transaction, so nothing else can have a run on it.
    if (run.kind !== 'started') throw new Error(`new site ${siteId} already had an active run`);
    return { kind: 'submitted', publicSlug, pipelineRunId: run.pipelineRunId };
  });
}
