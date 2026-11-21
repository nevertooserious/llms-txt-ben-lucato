import {
  loadLatestPipelineRunSummary,
  loadWorkspaceOverview,
  type DatabasePool,
  type PipelineRunSummary,
  type WorkspaceAccess,
} from '@llms-txt/db';
import { validateLlmsTxt } from '@llms-txt/generator';
import type { PipelineRunView, WorkspaceView } from '../shared/workspace-view';

/** Everything the workspace screen shows: the site, its latest run, the published file. */
export async function loadWorkspaceView(
  workspace: WorkspaceAccess,
  publicSlug: string,
  dependencies: { databasePool: DatabasePool; now?: Date },
): Promise<WorkspaceView | null> {
  const [overview, latestRun] = await Promise.all([
    loadWorkspaceOverview(dependencies.databasePool, workspace.id),
    loadLatestPipelineRunSummary(dependencies.databasePool, workspace.siteId),
  ]);
  if (overview === null) return null;
  const now = dependencies.now ?? new Date();
  const version = overview.publishedVersion;
  const isMonitoringEnabled = overview.monitoringEnabledUntil !== null && overview.monitoringEnabledUntil > now;
  return {
    publicSlug,
    rootUrl: overview.rootUrl,
    siteTitle: overview.siteTitle,
    hostedLlmsTxtPath: `/w/${encodeURIComponent(publicSlug)}/llms.txt`,
    monitoring: {
      isEnabled: isMonitoringEnabled,
      enabledUntil: isMonitoringEnabled ? overview.monitoringEnabledUntil!.toISOString() : null,
      nextCheckAt: isMonitoringEnabled ? (overview.nextMonitorCheckAt?.toISOString() ?? null) : null,
    },
    latestRun: latestRun === null ? null : pipelineRunView(latestRun),
    publishedVersion:
      version === null
        ? null
        : {
            versionNumber: version.versionNumber,
            llmsTxtContent: version.llmsTxtContent,
            listedPageCount: version.listedPageCount,
            createdAt: version.createdAt.toISOString(),
            validation: validateLlmsTxt(version.llmsTxtContent),
          },
  };
}

function pipelineRunView(run: PipelineRunSummary): PipelineRunView {
  return {
    ...run,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
