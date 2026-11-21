// What starts a run, and the queue the web app and the worker share.

export const PIPELINE_TRIGGERS = ['submission', 'monitor', 'user_check_now'] as const;
export type PipelineTrigger = (typeof PIPELINE_TRIGGERS)[number];

/** Queue names shared by the web app (producer) and the worker (consumer). */
export const QUEUE_NAMES = {
  pipelineRun: 'pipeline-run',
  monitorTick: 'monitor-tick',
} as const;

/** Payload of a `pipeline-run` job. One job is one site's run. */
export interface PipelineRunJob {
  pipelineRunId: string;
  siteId: string;
}
