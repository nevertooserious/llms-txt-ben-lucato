import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchOutcome, FetchRequest } from '../network/http-fetcher';
import { resolveSiteRootUrl } from './resolve-site-root';

// The redirect itself is followed by the fetcher (e2e/tests/site-root.test.ts runs that
// against a local server). Here the fetcher is a stand-in that redirects the homepage
// where the test says, and asks `isRedirectAllowed` first as the real one does.

const fetcherStandIn = vi.hoisted(() => ({ robotsTxt: '', homepageRedirectsTo: '', redirectWasRefused: false }));

vi.mock('../network/http-fetcher', () => ({
  HttpFetcher: class {
    fetch(fetchRequest: FetchRequest): Promise<FetchOutcome> {
      const respond = (finalUrl: string, body: string): Promise<FetchOutcome> =>
        Promise.resolve({
          kind: 'response',
          requestedUrl: fetchRequest.url,
          finalUrl,
          redirectChain: [],
          httpStatusCode: 200,
          headers: {},
          contentType: null,
          body,
        });
      if (fetchRequest.url.endsWith('/robots.txt')) return respond(fetchRequest.url, fetcherStandIn.robotsTxt);
      const target = fetcherStandIn.homepageRedirectsTo;
      if (fetchRequest.isRedirectAllowed?.(target) === false) {
        fetcherStandIn.redirectWasRefused = true;
        return Promise.resolve({
          kind: 'failed',
          requestedUrl: fetchRequest.url,
          failedUrl: target,
          reason: 'disallowed_by_robots',
          message: 'disallowed',
        });
      }
      return respond(target, '<html></html>');
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

const resolve = () => resolveSiteRootUrl({ rootUrl: 'https://example.com', minRequestIntervalMs: 0 });

describe('resolveSiteRootUrl', () => {
  beforeEach(() => {
    fetcherStandIn.robotsTxt = 'User-agent: *\nDisallow: /private/\n';
    fetcherStandIn.redirectWasRefused = false;
  });

  it('follows the homepage to another origin, whose robots.txt it has not read', async () => {
    fetcherStandIn.homepageRedirectsTo = 'https://www.example.com/private/';
    expect(await resolve()).toBe('https://www.example.com');
    expect(fetcherStandIn.redirectWasRefused).toBe(false);
  });

  it('does not follow a redirect into a path of its own host that robots.txt disallows', async () => {
    fetcherStandIn.homepageRedirectsTo = 'https://example.com/private/moved';
    expect(await resolve()).toBe('https://example.com');
    expect(fetcherStandIn.redirectWasRefused).toBe(true);
  });

  it('follows a redirect within its own host that robots.txt allows', async () => {
    fetcherStandIn.homepageRedirectsTo = 'https://example.com/en/';
    expect(await resolve()).toBe('https://example.com');
    expect(fetcherStandIn.redirectWasRefused).toBe(false);
  });
});
