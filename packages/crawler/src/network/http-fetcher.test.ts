import { afterEach, describe, expect, it } from 'vitest';
import { HttpFetcher, type FetchOutcome } from './http-fetcher';
import type { HostnameResolver } from './ssrf-guard';

// No network here: every case is refused before a socket opens. Fetches against real
// local servers are in e2e/tests/http-fetcher.test.ts.

const html = ['text/html'];
let fetcher: HttpFetcher | undefined;

afterEach(async () => {
  await fetcher?.close();
  fetcher = undefined;
});

function fetcherResolvingTo(addresses: string[]): HttpFetcher {
  const resolveHostname: HostnameResolver = async () => addresses;
  fetcher = new HttpFetcher({ resolveHostname, timeoutMs: 2_000 });
  return fetcher;
}

function expectFailure(outcome: FetchOutcome, reason: string) {
  expect(outcome.kind).toBe('failed');
  if (outcome.kind === 'failed') expect(outcome.reason).toBe(reason);
}

describe('HttpFetcher refusals', () => {
  it('refuses a hostname that resolves to a private address', async () => {
    const outcome = await fetcherResolvingTo(['10.0.0.5']).fetch({ url: 'https://example.com/', acceptedContentTypes: html });
    expectFailure(outcome, 'blocked_address');
  });

  it('refuses a hostname whose answers mix public and private addresses', async () => {
    const outcome = await fetcherResolvingTo(['93.184.216.34', '169.254.169.254']).fetch({
      url: 'http://example.com/',
      acceptedContentTypes: html,
    });
    expectFailure(outcome, 'blocked_address');
  });

  it('refuses private IP literals, including IPv4-mapped IPv6', async () => {
    const instance = fetcherResolvingTo([]);
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:10.0.0.1]/']) {
      expectFailure(await instance.fetch({ url, acceptedContentTypes: html }), 'blocked_address');
    }
  });

  it('refuses schemes other than http and https', async () => {
    const instance = fetcherResolvingTo([]);
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/']) {
      expectFailure(await instance.fetch({ url, acceptedContentTypes: html }), 'unsupported_scheme');
    }
  });

  it('refuses invalid URLs and URLs with credentials', async () => {
    const instance = fetcherResolvingTo([]);
    expectFailure(await instance.fetch({ url: 'not a url', acceptedContentTypes: html }), 'invalid_url');
    expectFailure(
      await instance.fetch({ url: 'https://user:secret@example.com/', acceptedContentTypes: html }),
      'invalid_url',
    );
  });
});
