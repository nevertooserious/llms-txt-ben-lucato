import { DEFAULT_CRAWL_PAGE_BUDGET } from '@llms-txt/contracts';
import { logLevel, positiveInteger, requiredString, type Environment, type LogLevel } from '@llms-txt/runtime';
import type { BasicAuthCredentials } from '../http/basic-auth';

/** Everything the web app reads from its environment, checked on first use. */
export interface WebConfig {
  databaseUrl: string;
  logLevel: LogLevel;
  /** Least time between a site's last run and a "check now" (docs/design/README.md, section 7). */
  checkNowCooldownSeconds: number;
  /** Most pages one run fetches. The worker enforces it from the same variable; the web app only shows it. */
  crawlPageBudget: number;
}

export function readWebConfig(environment: Environment = process.env): WebConfig {
  return {
    databaseUrl: requiredString(environment, 'DATABASE_URL'),
    logLevel: logLevel(environment, 'LOG_LEVEL', 'info'),
    checkNowCooldownSeconds: 5 * 60,
    crawlPageBudget: positiveInteger(environment, 'CRAWL_PAGE_BUDGET', DEFAULT_CRAWL_PAGE_BUDGET),
  };
}

/** The login of the one user, who is created from it at startup (server/users/authentication.ts). */
export function readBasicAuthCredentials(environment: Environment = process.env): BasicAuthCredentials {
  return {
    username: environment.BASIC_AUTH_USERNAME || 'user1',
    password: environment.BASIC_AUTH_PASSWORD || 'pass1',
  };
}

/** Set only by docker-compose.yml. Read apart from WebConfig, so other deployments skip the lookup. */
export function readDemoSiteEnabled(environment: Environment = process.env): boolean {
  return environment.DEMO_SITE_ENABLED === 'true';
}
