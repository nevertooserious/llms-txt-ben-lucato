import type { PipelineRunJob } from '@llms-txt/contracts';
import type { FinishedPipelineRun, PipelineStageDependencies } from './pipeline-dependencies';
import { crawlStage } from './stages/crawl-stage';
import { generateStage } from './stages/generate-stage';
import { loadSiteStage } from './stages/load-site-stage';
import { publishStage } from './stages/publish-stage';

/**
 * The stages of one run, in order. Each stage is the imperative shell around one step: it
 * loads state, hands it to a component and the pure decisions (reconcilePage,
 * evaluateSafetyGate, decidePublication, ...), and writes what they return. The rules
 * themselves live in those functions, where they are tested without a database. A stage
 * that cannot go on throws a PipelineRunFailure.
 */
export async function runPipelineStages(
  job: PipelineRunJob,
  dependencies: PipelineStageDependencies,
): Promise<FinishedPipelineRun> {
  const { site, storedPages } = await loadSiteStage(job, dependencies);
  const crawled = await crawlStage(job, dependencies, site, storedPages);
  const generationInput = await generateStage(job, dependencies, site, crawled);
  return publishStage(job, dependencies, site.id, generationInput);
}
