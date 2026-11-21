import {
  loadLatestPipelineRunSummary,
  listLlmsTxtVersions,
  loadSiteOverview,
  type DatabasePool,
  type PipelineRunSummary,
} from '@llms-txt/db';
import { validateLlmsTxt } from '@llms-txt/generator';
import type { PipelineRunView, SiteView } from '../shared/site-view';

/** Everything the site screen shows: the site, its latest run, the published file. */
export async function loadSiteView(
  siteId: string,
  publicSlug: string,
  dependencies: { databasePool: DatabasePool; now?: Date },
): Promise<SiteView | null> {
  const [overview, latestRun, versions] = await Promise.all([
    loadSiteOverview(dependencies.databasePool, siteId),
    loadLatestPipelineRunSummary(dependencies.databasePool, siteId),
    listLlmsTxtVersions(dependencies.databasePool, siteId),
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
    isPublishedVersionPinned: overview.isPublishedVersionPinned,
    versions: versions.map((summary) => ({ ...summary, createdAt: summary.createdAt.toISOString() })),
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
