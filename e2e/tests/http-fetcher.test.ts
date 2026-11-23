import { HttpFetcher, type FetchedResponse, type FetchOutcome } from '@llms-txt/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../support/fixture-site-server';
import { allowLoopbackPorts } from '../support/local-network-policy';

// The crawler's plain HTTP fetcher against local fixture sites: real sockets, real
// redirects, real timeouts. Pipeline-level cases are in site-flavours.test.ts.

const html = ['text/html'];

let staticSite: FixtureSite;
let hostileSite: FixtureSite;
/** Listening, but not allowed by the test policy: stands in for an internal service. */
let internalService: FixtureSite;
let fetcher: HttpFetcher;

beforeAll(async () => {
  [staticSite, hostileSite, internalService] = await Promise.all([
    startFixtureSite('static-site'),
    startFixtureSite('hostile-site'),
    startFixtureSite('static-site'),
  ]);
  fetcher = new HttpFetcher({
    networkPolicy: allowLoopbackPorts([staticSite.port, hostileSite.port]),
    timeoutMs: 1_500,
    maxResponseBytes: 1024 * 1024,
  });
});

afterAll(async () => {
  await fetcher.close();
  await Promise.all([staticSite.close(), hostileSite.close(), internalService.close()]);
});

function expectResponse(outcome: FetchOutcome): FetchedResponse {
  if (outcome.kind !== 'response') throw new Error(`expected a response, got ${outcome.reason}: ${outcome.message}`);
  return outcome;
}

function expectFailure(outcome: FetchOutcome, reason: string) {
  expect(outcome).toMatchObject({ kind: 'failed', reason });
}

describe('static pages', () => {
  it('fetches a server-rendered page', async () => {
    const response = expectResponse(await fetcher.fetch({ url: `${staticSite.origin}/`, acceptedContentTypes: html }));
    expect(response.httpStatusCode).toBe(200);
    expect(response.finalUrl).toBe(`${staticSite.origin}/`);
    expect(response.contentType).toBe('text/html');
    expect(response.body).toContain('<title>Static Fixture Co</title>');
  });

  it('decodes a page by the charset in its <meta>', async () => {
    const response = expectResponse(
      await fetcher.fetch({ url: `${staticSite.origin}/windows-1252.html`, acceptedContentTypes: html }),
    );
    expect(response.body).toContain('<title>Café crème</title>');
    expect(response.body).toContain('“Smart quotes”');
  });

  it('returns 404 as a response, not a failure', async () => {
    const response = expectResponse(
      await fetcher.fetch({ url: `${staticSite.origin}/missing-page`, acceptedContentTypes: html }),
    );
    expect(response.httpStatusCode).toBe(404);
  });

  it('sends a crawler user agent and asks for the accepted types', async () => {
    const response = expectResponse(
      await fetcher.fetch({ url: `${hostileSite.origin}/echo-headers`, acceptedContentTypes: ['application/json'] }),
    );
    const sentHeaders = JSON.parse(response.body) as Record<string, string>;
    expect(sentHeaders['user-agent']).toMatch(/^LlmsTxtGenerator\//);
    expect(sentHeaders.accept).toContain('application/json');
  });
});

describe('redirects', () => {
  it('follows a redirect chain and records it', async () => {
    const response = expectResponse(
      await fetcher.fetch({ url: `${hostileSite.origin}/redirect-chain`, acceptedContentTypes: html }),
    );
    expect(response.finalUrl).toBe(`${hostileSite.origin}/redirect-chain?hop=3`);
    expect(response.redirectChain).toHaveLength(3);
    expect(response.body).toContain('End of the chain');
  });

  it('gives up on a redirect loop', async () => {
    expectFailure(
      await fetcher.fetch({ url: `${hostileSite.origin}/redirect-loop`, acceptedContentTypes: html }),
      'too_many_redirects',
    );
  });

  it.each([
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a private range', 'http://10.0.0.1/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['an IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    ['a name that resolves to loopback', 'http://localhost/'],
  ])('refuses a redirect to %s', async (_label, target) => {
    const outcome = await fetcher.fetch({
      url: `${hostileSite.origin}/redirect?to=${encodeURIComponent(target)}`,
      acceptedContentTypes: html,
    });
    expectFailure(outcome, 'blocked_address');
    if (outcome.kind === 'failed') expect(outcome.failedUrl).toBe(new URL(target).href);
  });

  it('refuses a redirect to a loopback port that is not allowed, before connecting', async () => {
    const requestsBefore = internalService.requestLog.length;
    const outcome = await fetcher.fetch({
      url: `${hostileSite.origin}/redirect?to=${encodeURIComponent(`${internalService.origin}/`)}`,
      acceptedContentTypes: html,
    });
    expectFailure(outcome, 'blocked_address');
    expect(internalService.requestLog.length).toBe(requestsBefore);
  });

  it('refuses a redirect to a non-HTTP scheme', async () => {
    expectFailure(
      await fetcher.fetch({
        url: `${hostileSite.origin}/redirect?to=${encodeURIComponent('file:///etc/passwd')}`,
        acceptedContentTypes: html,
      }),
      'unsupported_scheme',
    );
  });
});

describe('limits and failures', () => {
  it('times out a server that never responds', async () => {
    expectFailure(await fetcher.fetch({ url: `${hostileSite.origin}/no-response`, acceptedContentTypes: html }), 'timeout');
  });

  it('times out a body that never finishes', async () => {
    expectFailure(await fetcher.fetch({ url: `${hostileSite.origin}/slow-body`, acceptedContentTypes: html }), 'timeout');
  });

  it('stops reading a streamed body over the size cap', async () => {
    expectFailure(
      await fetcher.fetch({ url: `${hostileSite.origin}/huge-streamed`, acceptedContentTypes: html }),
      'response_too_large',
    );
  });

  it('refuses a declared length over the size cap without reading it', async () => {
    expectFailure(
      await fetcher.fetch({ url: `${hostileSite.origin}/huge-declared`, acceptedContentTypes: html }),
      'response_too_large',
    );
  });

  it('returns 5xx and 410 as responses for the caller to judge', async () => {
    const serverError = expectResponse(
      await fetcher.fetch({ url: `${hostileSite.origin}/server-error`, acceptedContentTypes: html }),
    );
    expect(serverError.httpStatusCode).toBe(500);
    const gone = expectResponse(await fetcher.fetch({ url: `${hostileSite.origin}/gone`, acceptedContentTypes: html }));
    expect(gone.httpStatusCode).toBe(410);
  });
});

describe('content types', () => {
  it('skips non-HTML responses without reading them', async () => {
    expectFailure(
      await fetcher.fetch({ url: `${hostileSite.origin}/report.pdf`, acceptedContentTypes: html }),
      'unsupported_content_type',
    );
    expectFailure(
      await fetcher.fetch({ url: `${staticSite.origin}/logo.png`, acceptedContentTypes: html }),
      'unsupported_content_type',
    );
  });

  it('accepts a response with no Content-Type', async () => {
    const response = expectResponse(
      await fetcher.fetch({ url: `${hostileSite.origin}/no-content-type`, acceptedContentTypes: html }),
    );
    expect(response.contentType).toBeNull();
    expect(response.body).toContain('No content type');
  });
});

describe('conditional GET', () => {
  it('returns 304 with an empty body when the ETag still matches', async () => {
    const first = expectResponse(await fetcher.fetch({ url: `${hostileSite.origin}/conditional`, acceptedContentTypes: html }));
    const etag = first.headers.etag;
    expect(etag).toBeDefined();

    const second = expectResponse(
      await fetcher.fetch({ url: `${hostileSite.origin}/conditional`, acceptedContentTypes: html, ifNoneMatch: etag }),
    );
    expect(second.httpStatusCode).toBe(304);
    expect(second.body).toBe('');
  });
});
