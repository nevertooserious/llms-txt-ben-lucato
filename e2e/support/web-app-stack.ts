import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { PgBoss } from 'pg-boss';
import { crawlSite, HeadlessRenderer, resolveSiteRootUrl } from '@llms-txt/crawler';
import { createDatabasePool, type DatabasePool } from '@llms-txt/db';
import { generateLlmsTxt } from '@llms-txt/generator';
import { createLogger } from '@llms-txt/runtime';
import { readWorkerConfig } from '../../apps/worker/src/config/worker-config';
import { startWorkerJobs } from '../../apps/worker/src/jobs/worker-jobs';
import { createStubLlmClient } from '../../apps/worker/src/llm/stub-llm-client';
import { startFixtureSite, type FixtureSite } from './fixture-site-server';
import { allowLoopbackPorts } from './local-network-policy';

// The whole product as a user meets it, for the browser tests: the real web app
// (`next dev`, a child process), the real worker (in this process, so its network policy
// can open the fixture sites' loopback ports) and a database of its own.
//
// The database is created from db/schema.sql for this stack and dropped afterwards, so
// the web app's queue (pg-boss's default schema) is not shared with monitor.test.ts,
// whose worker runs on the same server at the same time and would take these jobs.
// Needs DATABASE_URL pointing at a role that may create databases (CI's e2e job has one).

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
const WEB_APP_DIRECTORY = resolve(REPOSITORY_ROOT, 'apps/web');
const NEXT_BINARY = resolve(REPOSITORY_ROOT, 'node_modules/.bin/next');
const WEB_APP_START_TIMEOUT_MS = 90_000;

export class WebAppStack {
  private readonly startedSites: FixtureSite[] = [];

  private constructor(
    /** e.g. http://127.0.0.1:54321 */
    readonly webAppOrigin: string,
    /** The stack's own database, for the few things a user cannot do through the UI. */
    readonly databasePool: DatabasePool,
    private readonly webApp: ChildProcess,
    private readonly webAppOutput: string[],
    private readonly workerQueue: PgBoss,
    private readonly headlessRenderer: HeadlessRenderer,
    private readonly allowedPorts: Set<number>,
    private readonly dropDatabase: () => Promise<void>,
  ) {}

  static async start(serverDatabaseUrl: string): Promise<WebAppStack> {
    const { databaseUrl, dropDatabase } = await createE2eDatabase(serverDatabaseUrl);

    const allowedPorts = new Set<number>();
    const networkPolicy = allowLoopbackPorts(allowedPorts);
    const headlessRenderer = new HeadlessRenderer({ networkPolicy, timeoutMs: 15_000 });
    const databasePool = createDatabasePool(databaseUrl);
    const workerQueue = new PgBoss({ connectionString: databaseUrl, schedule: false });
    await workerQueue.start();
    await startWorkerJobs({
      queue: workerQueue,
      databasePool,
      logger: createLogger({ level: 'error', fields: { process: 'e2e-worker' } }),
      config: { ...readWorkerConfig({ DATABASE_URL: databaseUrl , LLM_CLIENT: 'stub' }), crawlPageBudget: 30 },
      crawl: (options) => crawlSite({ ...options, networkPolicy, headlessRenderer, minRequestIntervalMs: 0 }),
      resolveRootUrl: (rootUrl) => resolveSiteRootUrl({ rootUrl, networkPolicy, minRequestIntervalMs: 0 }),
      renderLlmsTxt: generateLlmsTxt,
      llmClient: createStubLlmClient(),
      pollingIntervalSeconds: 0.5,
    });

    const port = await freePort();
    const webAppOutput: string[] = [];
    const webApp = spawn(NEXT_BINARY, ['dev', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: WEB_APP_DIRECTORY,
      env: { ...process.env, DATABASE_URL: databaseUrl, LOG_LEVEL: 'warn', NEXT_TELEMETRY_DISABLED: '1' },
      // Its own process group, so stopping it also stops the processes `next dev` starts.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [webApp.stdout!, webApp.stderr!]) stream.on('data', (chunk) => webAppOutput.push(String(chunk)));

    const stack = new WebAppStack(
      `http://127.0.0.1:${port}`,
      databasePool,
      webApp,
      webAppOutput,
      workerQueue,
      headlessRenderer,
      allowedPorts,
      dropDatabase,
    );
    try {
      await stack.waitUntilServing();
    } catch (error) {
      await stack.stop();
      throw error;
    }
    return stack;
  }

  async stop(): Promise<void> {
    if (this.webApp.exitCode === null && this.webApp.pid !== undefined) {
      const exited = new Promise((resolveExit) => this.webApp.once('exit', resolveExit));
      process.kill(-this.webApp.pid, 'SIGTERM');
      await Promise.race([exited, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))]);
    }
    await this.workerQueue.stop({ graceful: false });
    await this.headlessRenderer.close();
    await this.databasePool.end();
    await Promise.all(this.startedSites.map((site) => site.close()));
    await this.dropDatabase();
  }

  /** Serves a fixture site on a new port and opens that port to the worker's crawls. */
  async startSite(siteName: string): Promise<FixtureSite> {
    const site = await startFixtureSite(siteName);
    this.startedSites.push(site);
    this.allowedPorts.add(site.port);
    return site;
  }

  /** The web app's output so far, for a failing test's message. */
  webAppLog(): string {
    return this.webAppOutput.join('').slice(-4_000);
  }

  /**
   * Waits for `next dev` to answer, then requests each page once so it is compiled
   * before a test's timeouts start counting.
   */
  private async waitUntilServing(): Promise<void> {
    const deadline = Date.now() + WEB_APP_START_TIMEOUT_MS;
    for (const path of ['/', '/login', '/w/warm-up']) {
      for (;;) {
        if (this.webApp.exitCode !== null) throw new Error(`the web app exited:\n${this.webAppLog()}`);
        const authorization = `Basic ${Buffer.from('user1:pass1').toString('base64')}`;
        const status = await fetch(`${this.webAppOrigin}${path}`, { headers: { authorization } }).then(
          (response) => response.status,
          () => null,
        );
        if (status === 200) break;
        if (Date.now() > deadline) throw new Error(`the web app did not serve ${path} in time:\n${this.webAppLog()}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
    }
  }
}

/** How long dropping a test database waits for its connections to close by themselves. */
const DROP_DATABASE_WAIT_MS = 10_000;

/** A new database with db/schema.sql applied, for a test whose queue must not be shared. */
export async function createE2eDatabase(
  serverDatabaseUrl: string,
): Promise<{ databaseUrl: string; dropDatabase: () => Promise<void> }> {
  const databaseName = `llms_txt_e2e_${randomBytes(6).toString('hex')}`;
  const serverPool = createDatabasePool(serverDatabaseUrl);
  await serverPool.query(`create database ${databaseName}`);
  const databaseUrl = new URL(serverDatabaseUrl);
  databaseUrl.pathname = `/${databaseName}`;

  const schemaPool = createDatabasePool(databaseUrl.toString());
  try {
    await schemaPool.query(await readFile(resolve(REPOSITORY_ROOT, 'db/schema.sql'), 'utf8'));
  } finally {
    await schemaPool.end();
  }
  return {
    databaseUrl: databaseUrl.toString(),
    dropDatabase: async () => {
      // A pool or queue that was just stopped can still be closing its connections. One
      // that `force` ends reports it as an error nothing is listening for any more, which
      // fails the test run as an uncaught exception, so they get a moment to finish.
      const deadline = Date.now() + DROP_DATABASE_WAIT_MS;
      for (;;) {
        const connections = await serverPool.query<{ open: number }>(
          'select count(*)::int as open from pg_stat_activity where datname = $1',
          [databaseName],
        );
        if (connections.rows[0]!.open === 0 || Date.now() > deadline) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      // `with (force)` closes connections the web app may still hold.
      await serverPool.query(`drop database if exists ${databaseName} with (force)`);
      await serverPool.end();
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolvePort(address.port) : reject(new Error('no port'))));
    });
  });
}
