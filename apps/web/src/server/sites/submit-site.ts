import { randomBytes } from 'node:crypto';
import {
  countRecentWorkspacesFromIp,
  createWorkspace,
  enableWorkspaceMonitoring,
  findOrCreateSite,
  startPipelineRun,
  withTransaction,
  type DatabasePool,
  type PipelineRunQueue,
} from '@llms-txt/db';
import { MONITORING_DURATION_SECONDS } from './monitoring-duration';
import { normaliseSubmittedUrl } from './normalise-submitted-url';
import { sha256Hex } from '@/server/workspaces/workspace-access';

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
      workspaceId: string;
      publicSlug: string;
      /** The secret in the workspace's edit link. Returned once; only its hash is stored. */
      accessToken: string;
      /** The run generating the file: a new one, or the site's run already in progress. */
      pipelineRunId: string | null;
    }
  | { kind: 'invalid_url' }
  | { kind: 'rate_limited' };

const ONE_HOUR_SECONDS = 3600;

/**
 * A URL submission: rate-limit by IP, then in one transaction find or create the site,
 * create the submitter's workspace with monitoring on, and start a run (or join the
 * site's active one).
 */
export async function submitSite(
  request: SubmitSiteRequest,
  dependencies: SubmitSiteDependencies,
): Promise<SubmitSiteOutcome> {
  const rootUrl = normaliseSubmittedUrl(request.submittedUrl);
  if (rootUrl === null) return { kind: 'invalid_url' };

  const creatorIpHash = request.clientIp === null ? null : sha256Hex(request.clientIp);
  if (creatorIpHash !== null) {
    const recent = await countRecentWorkspacesFromIp(dependencies.databasePool, creatorIpHash, ONE_HOUR_SECONDS);
    if (recent >= dependencies.submissionsPerIpPerHour) return { kind: 'rate_limited' };
  }

  const accessToken = randomBytes(32).toString('base64url');
  const publicSlug = randomBytes(12).toString('base64url');
  return withTransaction(dependencies.databasePool, async (transaction) => {
    const siteId = await findOrCreateSite(transaction, rootUrl);
    const workspaceId = await createWorkspace(transaction, {
      siteId,
      accessTokenHash: sha256Hex(accessToken),
      publicSlug,
      creatorIpHash,
    });
    await enableWorkspaceMonitoring(transaction, {
      workspaceId,
      siteId,
      durationSeconds: MONITORING_DURATION_SECONDS,
    });
    const run = await startPipelineRun(transaction, dependencies.queue, {
      siteId,
      triggeredBy: 'submission',
      requestedByWorkspaceId: workspaceId,
    });
    return { kind: 'submitted', workspaceId, publicSlug, accessToken, pipelineRunId: run.pipelineRunId };
  });
}
