import type { PipelineRunJob } from '@llms-txt/contracts';
import {
  finishPipelineRun,
  loadExcludedUrlPrefixes,
  loadNewestVersion,
  loadPageOverrides,
  lockRunningPipelineRun,
  publishLlmsTxtVersion,
  withTransaction,
} from '@llms-txt/db';
import { decidePublication, excludePagesUnderUrlPrefixes, NOTHING_TO_LIST_REASON, selectPages } from '@llms-txt/generator';
import type { FinishedPipelineRun, PipelineStageDependencies } from '../pipeline-dependencies';
import { PipelineRunFailure } from '../pipeline-run-failure';
import type { SiteGenerationInput } from './generate-stage';

/**
 * Renders the file with the user's overrides and excluded paths, publishes a version if the text changed,
 * and finishes the run. Throws when the site has nothing to list and has never published.
 */
export async function publishStage(
  job: PipelineRunJob,
  dependencies: PipelineStageDependencies,
  siteId: string,
  generationInput: SiteGenerationInput,
): Promise<FinishedPipelineRun> {
  const { databasePool, logger } = dependencies;
  const { pipelineRunId } = job;

  // Judged before the user's exclusions: a user may empty their own file. A site that has
  // published before is let through: its pages went one by one, on their own 404s, and the
  // file should lose those links rather than keep them.
  const newestVersion = await loadNewestVersion(databasePool, siteId);
  if (newestVersion === null && selectPages(generationInput.pages, []).length === 0) {
    throw new PipelineRunFailure(NOTHING_TO_LIST_REASON);
  }
  const rendered = dependencies.renderLlmsTxt({
    ...generationInput,
    overrides: excludePagesUnderUrlPrefixes(
      await loadPageOverrides(databasePool, siteId),
      await loadExcludedUrlPrefixes(databasePool, siteId),
      generationInput.pages,
    ),
  });
  const decision = decidePublication(newestVersion?.llmsTxtContent ?? null, rendered);
  if (decision.kind === 'unchanged') {
    return { status: 'unchanged', isRecorded: await finishPipelineRun(databasePool, pipelineRunId, { status: 'unchanged' }) };
  }

  // The version and the run's outcome are written together, so a worker that stops between
  // the two cannot leave a published version behind a run that is later reaped as failed.
  const { version, status, isRecorded } = await withTransaction(databasePool, async (transaction) => {
    // A run the reaper has failed must not publish, even if it got this far.
    if (!(await lockRunningPipelineRun(transaction, pipelineRunId))) {
      throw new PipelineRunFailure('The run was failed for missing heartbeats before it could publish.');
    }
    const version = await publishLlmsTxtVersion(transaction, {
      siteId,
      pipelineRunId,
      createdBy: 'pipeline',
      llmsTxtContent: decision.llmsTxtContent,
      llmsTxtContentHash: decision.llmsTxtContentHash,
      listedPageCount: decision.listedPageCount,
      pageChanges: decision.pageChanges,
    });
    const status = version === null ? ('unchanged' as const) : ('succeeded' as const);
    return { version, status, isRecorded: await finishPipelineRun(transaction, pipelineRunId, { status }) };
  });
  if (version !== null) {
    logger.info('published', { versionNumber: version.versionNumber, isLive: version.isLive, ...decision.pageChanges });
  }
  return { status, isRecorded };
}
