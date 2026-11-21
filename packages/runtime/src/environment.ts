import { LOG_LEVELS, type LogLevel } from './logger';

// Typed readers for environment variables. Each process reads its whole configuration
// once at startup through these, so a missing or malformed value stops it there with a
// message that names the variable, not later inside a request or a run.

export type Environment = Record<string, string | undefined>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function requiredString(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} must be set`);
  return value;
}

export function optionalString(environment: Environment, name: string): string | null {
  return environment[name]?.trim() || null;
}

export function positiveInteger(environment: Environment, name: string, defaultValue: number): number {
  const raw = environment[name]?.trim();
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigurationError(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

export function logLevel(environment: Environment, name: string, defaultValue: LogLevel): LogLevel {
  const raw = environment[name]?.trim();
  if (!raw) return defaultValue;
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new ConfigurationError(`${name} must be one of ${LOG_LEVELS.join(', ')}, got "${raw}"`);
  }
  return raw as LogLevel;
}
