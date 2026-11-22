import { logLevel, requiredString, type Environment, type LogLevel } from '@llms-txt/runtime';
import type { BasicAuthCredentials } from '../http/basic-auth';

/** Everything the web app reads from its environment, checked on first use. */
export interface WebConfig {
  databaseUrl: string;
  logLevel: LogLevel;
  /** Least time between a site's last run and a "check now" (docs/design/README.md, section 7). */
  checkNowCooldownSeconds: number;
}

export function readWebConfig(environment: Environment = process.env): WebConfig {
  return {
    databaseUrl: requiredString(environment, 'DATABASE_URL'),
    logLevel: logLevel(environment, 'LOG_LEVEL', 'info'),
    checkNowCooldownSeconds: 5 * 60,
  };
}

// Read apart from WebConfig, which needs DATABASE_URL: the login runs on every request,
// and a deployment without the demo must not touch the database to find that out.

export function readBasicAuthCredentials(environment: Environment = process.env): BasicAuthCredentials {
  return {
    username: environment.BASIC_AUTH_USERNAME || 'user1',
    password: environment.BASIC_AUTH_PASSWORD || 'pass1',
  };
}

/** Set only by docker-compose.yml. */
export function readDemoSiteEnabled(environment: Environment = process.env): boolean {
  return environment.DEMO_SITE_ENABLED === 'true';
}
