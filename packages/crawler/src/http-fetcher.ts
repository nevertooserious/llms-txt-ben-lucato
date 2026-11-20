import { Agent, errors as undiciErrors, request } from 'undici';
import { decodeBody } from './decode-body';
import { readCapped, ResponseTooLargeError } from './read-capped';
import {
  BlockedAddressError,
  buildGuardedConnector,
  publicInternetOnly,
  type HostnameResolver,
  type NetworkPolicy,
} from './ssrf-guard';

// Plain HTTP fetching for the crawler: pages, robots.txt, sitemaps and .md variants.
// Every connection, including each redirect hop, goes through the SSRF guard.

export const DEFAULT_USER_AGENT = 'LlmsTxtGenerator/0.1 (+https://llmstxt.org)';

export interface HttpFetcherOptions {
  /** Production uses `publicInternetOnly`. Tests pass a policy that allows their local servers. */
  networkPolicy?: NetworkPolicy;
  resolveHostname?: HostnameResolver;
  userAgent?: string;
  /** Total time for one fetch, redirects included. */
  timeoutMs?: number;
  /** Responses larger than this fail with `response_too_large`. */
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export interface FetchRequest {
  url: string;
  /**
   * Media types to read the body of, e.g. `text/html`. A 2xx response of any other type
   * fails with `unsupported_content_type` without its body being read; any other status
   * comes back as a response with an empty body, since an error page's type says nothing
   * about the URL. A missing Content-Type is treated as acceptable, since many servers
   * omit it.
   */
  acceptedContentTypes: readonly string[];
  /** Conditional GET validators from the previous fetch. */
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

export interface FetchedResponse {
  kind: 'response';
  requestedUrl: string;
  /** Where the request ended up after redirects. */
  finalUrl: string;
  /** Every URL fetched before the final one, in order. */
  redirectChain: string[];
  httpStatusCode: number;
  /** Lowercased names; repeated headers joined with ", ". */
  headers: Record<string, string>;
  /** The media type without parameters, lowercased, or null if absent. */
  contentType: string | null;
  /** The decoded body. Empty for 304 and other bodiless responses. */
  body: string;
}

export const FETCH_FAILURE_REASONS = [
  'invalid_url',
  'unsupported_scheme',
  'blocked_address',
  'too_many_redirects',
  'timeout',
  'response_too_large',
  'unsupported_content_type',
  'network_error',
] as const;
export type FetchFailureReason = (typeof FETCH_FAILURE_REASONS)[number];

export interface FetchFailure {
  kind: 'failed';
  requestedUrl: string;
  /** The URL being fetched when it failed: differs from `requestedUrl` after a redirect. */
  failedUrl: string;
  reason: FetchFailureReason;
  message: string;
}

export type FetchOutcome = FetchedResponse | FetchFailure;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export class HttpFetcher {
  private readonly dispatcher: Agent;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRedirects: number;

  constructor(options: HttpFetcherOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.dispatcher = new Agent({
      connect: buildGuardedConnector({
        networkPolicy: options.networkPolicy ?? publicInternetOnly,
        resolveHostname: options.resolveHostname,
        connectTimeoutMs: this.timeoutMs,
      }),
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
  }

  async fetch(fetchRequest: FetchRequest): Promise<FetchOutcome> {
    const { url: requestedUrl } = fetchRequest;
    const signal = AbortSignal.timeout(this.timeoutMs);
    const redirectChain: string[] = [];
    let currentUrl = requestedUrl;

    const fail = (reason: FetchFailureReason, message: string): FetchFailure => ({
      kind: 'failed',
      requestedUrl,
      failedUrl: currentUrl,
      reason,
      message,
    });

    for (;;) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        return fail('invalid_url', `not a valid URL: ${currentUrl}`);
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return fail('unsupported_scheme', `only http and https are fetched, not ${parsedUrl.protocol}`);
      }
      // Credentials in a URL would be sent to the target; never fetch them.
      if (parsedUrl.username !== '' || parsedUrl.password !== '') {
        return fail('invalid_url', 'URLs with credentials are not fetched');
      }
      parsedUrl.hash = '';

      let response: Awaited<ReturnType<typeof request>>;
      try {
        response = await request(parsedUrl, {
          method: 'GET',
          dispatcher: this.dispatcher,
          signal,
          headers: this.requestHeaders(fetchRequest),
        });
      } catch (error) {
        return fail(...classifyError(error, signal));
      }

      const headers = flattenHeaders(response.headers);
      const location = headers['location'];
      if (REDIRECT_STATUS_CODES.has(response.statusCode) && location !== undefined) {
        await response.body.dump().catch(() => undefined);
        if (redirectChain.length >= this.maxRedirects) {
          return fail('too_many_redirects', `more than ${this.maxRedirects} redirects`);
        }
        redirectChain.push(parsedUrl.href);
        try {
          currentUrl = new URL(location, parsedUrl).href;
        } catch {
          return fail('invalid_url', `redirect to an invalid URL: ${location}`);
        }
        continue;
      }

      const contentType = mediaType(headers['content-type']);
      if (contentType !== null && !fetchRequest.acceptedContentTypes.includes(contentType)) {
        await response.body.dump().catch(() => undefined);
        // An error page's type says nothing about the URL; its status is what matters.
        const isSuccess = response.statusCode >= 200 && response.statusCode < 300;
        if (!isSuccess) {
          return { kind: 'response', requestedUrl, finalUrl: parsedUrl.href, redirectChain, httpStatusCode: response.statusCode, headers, contentType, body: '' };
        }
        return fail('unsupported_content_type', `content type ${contentType} is not one of the accepted types`);
      }

      const declaredLength = Number(headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
        response.body.destroy();
        return fail('response_too_large', `declared length ${declaredLength} exceeds ${this.maxResponseBytes} bytes`);
      }

      let bodyBytes: Buffer;
      try {
        bodyBytes = await readCapped(response.body, this.maxResponseBytes);
      } catch (error) {
        if (error instanceof ResponseTooLargeError) {
          return fail('response_too_large', `body exceeds ${this.maxResponseBytes} bytes`);
        }
        return fail(...classifyError(error, signal));
      }

      return {
        kind: 'response',
        requestedUrl,
        finalUrl: parsedUrl.href,
        redirectChain,
        httpStatusCode: response.statusCode,
        headers,
        contentType,
        body: decodeBody(bodyBytes, headers['content-type']),
      };
    }
  }

  /** Closes pooled connections. Call when the crawl is done. */
  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  private requestHeaders(fetchRequest: FetchRequest): Record<string, string> {
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: [...fetchRequest.acceptedContentTypes, '*/*;q=0.1'].join(', '),
      'accept-language': 'en;q=1.0, *;q=0.5',
    };
    if (fetchRequest.ifNoneMatch !== undefined) headers['if-none-match'] = fetchRequest.ifNoneMatch;
    if (fetchRequest.ifModifiedSince !== undefined) headers['if-modified-since'] = fetchRequest.ifModifiedSince;
    return headers;
  }
}

function classifyError(error: unknown, signal: AbortSignal): [FetchFailureReason, string] {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof BlockedAddressError) return ['blocked_address', message];
  if (
    signal.aborted ||
    error instanceof undiciErrors.HeadersTimeoutError ||
    error instanceof undiciErrors.BodyTimeoutError ||
    error instanceof undiciErrors.ConnectTimeoutError
  ) {
    return ['timeout', message];
  }
  return ['network_error', message];
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flattened[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flattened;
}

function mediaType(contentTypeHeader: string | undefined): string | null {
  if (contentTypeHeader === undefined) return null;
  const type = contentTypeHeader.split(';')[0]!.trim().toLowerCase();
  return type === '' ? null : type;
}
