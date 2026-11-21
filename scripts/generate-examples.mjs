#!/usr/bin/env node
// Generates an llms.txt for a set of real sites, one per kind of site, through a running
// stack's REST API, and saves each file to docs/examples/. Prints a markdown table of the
// results for docs/examples/README.md, which is written by hand.
//
//   docker compose up --build               # with ANTHROPIC_API_KEY in .env
//   node scripts/generate-examples.mjs      # every site
//   node scripts/generate-examples.mjs https://vitest.dev   # only these
//
// Reads BASE_URL (default http://localhost:3000) and the app's BASIC_AUTH_USERNAME and
// BASIC_AUTH_PASSWORD. Each site is a new submission, so a run of all of them uses most
// of an IP's hourly submission limit.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLE_SITES = [
  { url: 'https://vitest.dev', kind: 'Documentation, statically generated' },
  { url: 'https://docs.nestjs.com', kind: 'Documentation, an Angular app served prerendered' },
  { url: 'https://rxjs.dev', kind: 'Documentation, rendered in the browser' },
  { url: 'https://bun.sh', kind: 'Product site with its own llms.txt' },
  { url: 'https://tailscale.com', kind: 'Marketing site' },
  { url: 'https://overreacted.io', kind: 'Blog' },
  { url: 'https://www.deathwishcoffee.com', kind: 'Shop' },
  { url: 'https://www.ruby-lang.org/ja', kind: 'Not in English, under a path' },
  { url: 'https://danluu.com', kind: 'Plain HTML with no navigation' },
  { url: 'https://www.python.org', kind: 'Large site with many sections' },
];

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTHORIZATION = `Basic ${Buffer.from(
  `${process.env.BASIC_AUTH_USERNAME || 'user1'}:${process.env.BASIC_AUTH_PASSWORD || 'pass1'}`,
).toString('base64')}`;
const EXAMPLES_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples');
const POLL_INTERVAL_MS = 3000;
/** Longer than the longest run: a crawl stops taking pages after 15 minutes. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

async function request(apiPath, init = {}) {
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    ...init,
    headers: { authorization: AUTHORIZATION, ...init.headers },
  }).catch((error) => {
    throw new Error(`could not reach ${BASE_URL} (${error.cause?.code ?? error.message}); is the stack running?`);
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${apiPath} answered ${response.status}: ${await response.text()}`);
  }
  return response;
}

/** `https://www.ruby-lang.org/ja` becomes `www.ruby-lang.org-ja.txt`. */
function exampleFileName(siteUrl) {
  const { host, pathname } = new URL(siteUrl);
  return `${host}${pathname.replace(/\/$/, '').replaceAll('/', '-')}.txt`;
}

async function generateExample(site) {
  const submission = await request('/api/sites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: site.url }),
  });
  const { publicSlug, pipelineRunId } = await submission.json();
  const runPath = `/api/sites/${publicSlug}/runs/${pipelineRunId}`;

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let run;
  do {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    run = await (await request(runPath)).json();
  } while ((run.status === 'queued' || run.status === 'running') && Date.now() < deadline);

  const result = { ...site, run, fileName: null, listedEntryCount: 0 };
  if (run.status === 'succeeded') {
    const llmsTxt = await (await request(`${runPath}/llms.txt`)).text();
    result.fileName = exampleFileName(site.url);
    result.listedEntryCount = llmsTxt.split('\n').filter((line) => line.startsWith('- [')).length;
    await writeFile(path.join(EXAMPLES_DIRECTORY, result.fileName), llmsTxt);
  }
  console.error(`${site.url}: ${run.status}${run.errorMessage ? ` (${run.errorMessage})` : ''}`);
  return result;
}

function tableRow(result) {
  const { run } = result;
  const outcome = result.fileName ? `[${result.fileName}](${result.fileName})` : `${run.status}: ${run.errorMessage ?? ''}`;
  const seconds = run.finishedAt ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.createdAt)) / 1000) : '';
  return `| ${result.url} | ${result.kind} | ${outcome} | ${run.pagesFetchedCount} | ${run.pagesFailedCount} | ${result.listedEntryCount} | ${seconds} |`;
}

const requestedUrls = process.argv.slice(2);
const sites =
  requestedUrls.length === 0
    ? EXAMPLE_SITES
    : requestedUrls.map((url) => EXAMPLE_SITES.find((site) => site.url === url) ?? { url, kind: '' });

await mkdir(EXAMPLES_DIRECTORY, { recursive: true });
// All at once: the worker runs sites in parallel, and each is a different host.
const outcomes = await Promise.allSettled(sites.map(generateExample));

console.log('| Site | Kind | File | Pages fetched | Fetches failed | Entries | Seconds |');
console.log('|---|---|---|---|---|---|---|');
outcomes.forEach((outcome, index) => {
  if (outcome.status === 'fulfilled') {
    console.log(tableRow(outcome.value));
  } else {
    console.log(`| ${sites[index].url} | ${sites[index].kind} | error: ${outcome.reason.message} | | | | |`);
    process.exitCode = 1;
  }
});
