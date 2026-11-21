import { createHash, randomBytes } from 'node:crypto';
import {
  countRecentSitesFromIp,
  createSite,
  enableSiteMonitoring,
  startPipelineRun,
  withTransaction,
  type DatabasePool,
  type PipelineRunQueue,
} from '@llms-txt/db';
import { MONITORING_DURATION_SECONDS } from './monitoring-duration';
import { normaliseSubmittedUrl } from './normalise-submitted-url';

export interface SubmitSiteDependencies {
  databasePool: DatabasePool;
  queue: PipelineRunQueue;
  submissionsPerIpPerHour: number;
}

export interface SubmitSiteRequest {
  submittedUrl: string;
  clientIp: string | null;
}

export type SubmitSiteOutcome =
  | {
      kind: 'submitted';
      publicSlug: string;
      pipelineRunId: string;
    }
  | { kind: 'invalid_url' }
  | { kind: 'rate_limited' };

const ONE_HOUR_SECONDS = 3600;

/**
 * A URL submission: rate-limit by IP, then in one transaction create a new site with
 * monitoring on and start its first run. Each submission is an independent site, even
 * for a URL submitted before.
 */
export async function submitSite(
  request: SubmitSiteRequest,
  dependencies: SubmitSiteDependencies,
): Promise<SubmitSiteOutcome> {
  const rootUrl = normaliseSubmittedUrl(request.submittedUrl);
  if (rootUrl === null) return { kind: 'invalid_url' };

  const creatorIpHash = request.clientIp === null ? null : createHash('sha256').update(request.clientIp).digest('hex');
  if (creatorIpHash !== null) {
    const recent = await countRecentSitesFromIp(dependencies.databasePool, creatorIpHash, ONE_HOUR_SECONDS);
    if (recent >= dependencies.submissionsPerIpPerHour) return { kind: 'rate_limited' };
  }

  const publicSlug = randomBytes(12).toString('base64url');
  return withTransaction(dependencies.databasePool, async (transaction) => {
    const siteId = await createSite(transaction, { rootUrl, publicSlug, creatorIpHash });
    await enableSiteMonitoring(transaction, { siteId, durationSeconds: MONITORING_DURATION_SECONDS });
    const run = await startPipelineRun(transaction, dependencies.queue, { siteId, triggeredBy: 'submission' });
    // The site was created in this transaction, so nothing else can have a run on it.
    if (run.kind !== 'started') throw new Error(`new site ${siteId} already had an active run`);
    return { kind: 'submitted', publicSlug, pipelineRunId: run.pipelineRunId };
  });
}
