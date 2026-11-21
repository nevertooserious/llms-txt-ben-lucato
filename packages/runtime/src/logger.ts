// Structured logging: one JSON object per line on stdout, so a run can be followed by
// filtering on its pipelineRunId. Child loggers carry fields onto every line they write.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  fields?: LogFields;
  /** Where lines go. Tests pass their own. */
  writeLine?: (line: string) => void;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions): Logger {
  const minimumRank = LOG_LEVELS.indexOf(options.level);
  const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const build = (boundFields: LogFields): Logger => {
    const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
      if (LOG_LEVELS.indexOf(level) < minimumRank) return;
      const entry = { time: now().toISOString(), level, message, ...boundFields, ...fields };
      writeLine(JSON.stringify(entry, serialiseErrors));
    };
    return {
      debug: (message, fields) => write('debug', message, fields),
      info: (message, fields) => write('info', message, fields),
      warn: (message, fields) => write('warn', message, fields),
      error: (message, fields) => write('error', message, fields),
      child: (fields) => build({ ...boundFields, ...fields }),
    };
  };
  return build(options.fields ?? {});
}

/** Errors have no enumerable fields, so JSON.stringify would write `{}`. */
function serialiseErrors(_key: string, value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}
