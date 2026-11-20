import { describe, it } from 'vitest';

describe('enqueueDueMonitorChecks', () => {
  it.todo('enqueues only sites whose next check is due');
  it.todo('skips sites that already have a queued or running run');
});

describe('reapStalePipelineRuns', () => {
  it.todo('fails running rows whose heartbeat is stale and leaves fresh ones');
});
