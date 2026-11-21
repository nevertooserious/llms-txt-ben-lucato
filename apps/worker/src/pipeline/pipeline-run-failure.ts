/** Fails the run with a message for the user; not a bug. */
export class PipelineRunFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineRunFailure';
  }
}
