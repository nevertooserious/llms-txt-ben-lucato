import type { PipelineRunJob } from '@llms-txt/contracts';
import {
  finishPipelineRun,
  loadNewestVersion,
  loadWorkspaceIdsForSite,
  loadWorkspaceOverrides,
  lockRunningPipelineRun,
  lockSiteRow,
  publishLlmsTxtVersion,
  withTransaction,
} from '@llms-txt/db';
import { decidePublication } from '@llms-txt/generator';
import type { FinishedPipelineRun, PipelineStageDependencies } from '../pipeline-dependencies';
import { PipelineRunFailure } from '../pipeline-run-failure';
import type { SiteGenerationInput } from './generate-stage';

/**
 * Renders the file for each of the site's workspaces with that workspace's overrides,
 * publishes a version where the text changed, and finishes the run.
 */
export async function publishStage(
  job: PipelineRunJob,
  dependencies: PipelineStageDependencies,
  siteId: string,
  generationInput: SiteGenerationInput,
): Promise<FinishedPipelineRun> {
  const { databasePool, logger } = dependencies;
  const { pipelineRunId } = job;
  const renderedWorkspaceIds = new Set<string>();
  let publishedCount = 0;
  for (;;) {
    for (const workspaceId of await loadWorkspaceIdsForSite(databasePool, siteId)) {
      if (renderedWorkspaceIds.has(workspaceId)) continue;
      renderedWorkspaceIds.add(workspaceId);
      const rendered = dependencies.renderLlmsTxt({
        ...generationInput,
        overrides: await loadWorkspaceOverrides(databasePool, workspaceId),
      });
      const newestVersion = await loadNewestVersion(databasePool, workspaceId);
      const decision = decidePublication(newestVersion?.llmsTxtContent ?? null, rendered);
      if (decision.kind === 'unchanged') continue;

      const version = await withTransaction(databasePool, async (transaction) => {
        // A run the reaper has failed must not publish, even if it got this far.
        if (!(await lockRunningPipelineRun(transaction, pipelineRunId))) {
          throw new PipelineRunFailure('The run was failed for missing heartbeats before it could publish.');
        }
        return publishLlmsTxtVersion(transaction, {
          workspaceId,
          pipelineRunId,
          createdBy: 'pipeline',
          llmsTxtContent: decision.llmsTxtContent,
          llmsTxtContentHash: decision.llmsTxtContentHash,
          listedPageCount: decision.listedPageCount,
          pageChanges: decision.pageChanges,
        });
      });
      // The user deleted this workspace during the run.
      if (version === null) continue;
      logger.info('published', {
        workspaceId,
        versionNumber: version.versionNumber,
        isLive: version.isLive,
        ...decision.pageChanges,
      });
      publishedCount += 1;
    }

    // Finish under the site's lock, so a submission either lands before this check and is
    // rendered above, or lands after it and starts a run of its own.
    const status = publishedCount > 0 ? 'succeeded' : 'unchanged';
    const finished = await withTransaction(databasePool, async (transaction) => {
      await lockSiteRow(transaction, siteId);
      const workspaceIds = await loadWorkspaceIdsForSite(transaction, siteId);
      if (workspaceIds.some((workspaceId) => !renderedWorkspaceIds.has(workspaceId))) return null;
      return { status, isRecorded: await finishPipelineRun(transaction, pipelineRunId, { status }) } as const;
    });
    if (finished !== null) return finished;
  }
}
