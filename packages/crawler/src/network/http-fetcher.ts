import { brotliDecompressSync, constants as zlib, gunzipSync, inflateSync } from 'node:zlib';
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

// The product token robots.txt groups are matched against comes first. By convention a
// crawler's user agent also links a page that explains it; that page does not exist until
// the app is hosted, so the worker should pass `userAgent` with it then.
export const DEFAULT_USER_AGENT = 'LlmsTxtGenerator/0.1';

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
   * omit it. The wildcard type, star-slash-star, accepts any type.
   */
  acceptedContentTypes: readonly string[];
  /** Overrides the fetcher's size cap for this request, e.g. 50 MB for a sitemap. */
  maxResponseBytes?: number;
  /** Keep the first `maxResponseBytes` of a larger body instead of failing (robots.txt). */
  truncateAtMaxBytes?: boolean;
  /** Gunzip a body that starts with the gzip magic bytes (a `.xml.gz` sitemap). The cap applies after. */
  decompressGzip?: boolean;
  /** Checked for every redirect target; false fails the fetch with `disallowed_by_robots`. */
  isRedirectAllowed?: (url: string) => boolean;
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
  'disallowed_by_robots',
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
    const signal = AbortSignal.timeout(this.timeoutMs);
    const progress: FetchProgress = { currentUrl: fetchRequest.url, redirectChain: [] };
    try {
      return await this.fetchFollowingRedirects(fetchRequest, progress, signal);
    } catch (error) {
      if (!(error instanceof FetchFailedError)) throw error;
      return {
        kind: 'failed',
        requestedUrl: fetchRequest.url,
        failedUrl: progress.currentUrl,
        reason: error.reason,
        message: error.message,
      };
    }
  }

  /** Throws FetchFailedError for every way a fetch can fail. */
  private async fetchFollowingRedirects(
    fetchRequest: FetchRequest,
    progress: FetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedResponse> {
    for (;;) {
      const url = fetchableUrlOf(progress.currentUrl);
      const response = await request(url, {
        method: 'GET',
        dispatcher: this.dispatcher,
        signal,
        headers: this.requestHeaders(fetchRequest),
      }).catch((error: unknown) => {
        throw new FetchFailedError(...classifyError(error, signal));
      });

      const headers = flattenHeaders(response.headers);
      if (REDIRECT_STATUS_CODES.has(response.statusCode) && headers.location !== undefined) {
        await response.body.dump().catch(() => undefined);
        this.followRedirect(fetchRequest, progress, url, headers.location);
        continue;
      }

      return {
        kind: 'response',
        requestedUrl: fetchRequest.url,
        finalUrl: url.href,
        redirectChain: progress.redirectChain,
        httpStatusCode: response.statusCode,
        headers,
        contentType: mediaType(headers['content-type']),
        body: await this.readBody(fetchRequest, response, headers, signal),
      };
    }
  }

  /** Moves `progress` on to the redirect's target, or throws when it may not be followed. */
  private followRedirect(fetchRequest: FetchRequest, progress: FetchProgress, from: URL, location: string): void {
    if (progress.redirectChain.length >= this.maxRedirects) {
      throw new FetchFailedError('too_many_redirects', `more than ${this.maxRedirects} redirects`);
    }
    progress.redirectChain.push(from.href);
    try {
      progress.currentUrl = new URL(location, from).href;
    } catch {
      throw new FetchFailedError('invalid_url', `redirect to an invalid URL: ${location}`);
    }
    if (fetchRequest.isRedirectAllowed?.(progress.currentUrl) === false) {
      throw new FetchFailedError('disallowed_by_robots', `redirect to ${progress.currentUrl}, which robots.txt disallows`);
    }
  }

  /** The decoded body; empty, and unread, for an error response of a type that was not asked for. */
  private async readBody(
    fetchRequest: FetchRequest,
    response: ResponseData,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    const contentType = mediaType(headers['content-type']);
    const acceptsAnyType = fetchRequest.acceptedContentTypes.includes('*/*');
    if (contentType !== null && !acceptsAnyType && !fetchRequest.acceptedContentTypes.includes(contentType)) {
      await response.body.dump().catch(() => undefined);
      // An error page's type says nothing about the URL; its status is what matters.
      const isSuccess = response.statusCode >= 200 && response.statusCode < 300;
      if (!isSuccess) return '';
      throw new FetchFailedError('unsupported_content_type', `content type ${contentType} is not one of the accepted types`);
    }

    const maxResponseBytes = fetchRequest.maxResponseBytes ?? this.maxResponseBytes;
    const declaredLength = Number(headers['content-length']);
    if (!fetchRequest.truncateAtMaxBytes && Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      response.body.destroy();
      throw new FetchFailedError('response_too_large', `declared length ${declaredLength} exceeds ${maxResponseBytes} bytes`);
    }

    const bodyBytes = await readCapped(response.body, maxResponseBytes, { truncate: fetchRequest.truncateAtMaxBytes }).catch(
      (error: unknown) => {
        if (error instanceof ResponseTooLargeError) {
          throw new FetchFailedError('response_too_large', `body exceeds ${maxResponseBytes} bytes`);
        }
        throw new FetchFailedError(...classifyError(error, signal));
      },
    );
    return decodeBody(this.decompress(fetchRequest, bodyBytes, headers, maxResponseBytes), headers['content-type']);
  }

  private decompress(
    fetchRequest: FetchRequest,
    bodyBytes: Buffer,
    headers: Record<string, string>,
    maxResponseBytes: number,
  ): Buffer {
    try {
      // No encoding is asked for, but some servers compress every response anyway.
      const decoded = decodeContentEncoding(bodyBytes, headers['content-encoding'], maxResponseBytes, fetchRequest.truncateAtMaxBytes);
      return fetchRequest.decompressGzip ? gunzipIfGzipped(decoded, maxResponseBytes) : decoded;
    } catch (error) {
      if (error instanceof RangeError) {
        throw new FetchFailedError('response_too_large', `decompressed body exceeds ${maxResponseBytes} bytes`);
      }
      throw new FetchFailedError('network_error', `could not decompress: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Closes pooled connections. Call when the crawl is done. */
  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  private requestHeaders(fetchRequest: FetchRequest): Record<string, string> {
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: fetchRequest.acceptedContentTypes.includes('*/*')
        ? '*/*'
        : [...fetchRequest.acceptedContentTypes, '*/*;q=0.1'].join(', '),
      'accept-language': 'en;q=1.0, *;q=0.5',
    };
    if (fetchRequest.ifNoneMatch !== undefined) headers['if-none-match'] = fetchRequest.ifNoneMatch;
    if (fetchRequest.ifModifiedSince !== undefined) headers['if-modified-since'] = fetchRequest.ifModifiedSince;
    return headers;
  }
}

type ResponseData = Awaited<ReturnType<typeof request>>;

/** Where a fetch has got to: what a failure reports, and what the response is built from. */
interface FetchProgress {
  /** The URL being fetched: the requested one, then each redirect's target. */
  currentUrl: string;
  /** Every URL fetched before the current one, in order. */
  redirectChain: string[];
}

/** Thrown inside a fetch for a failure the caller is told about as a FetchFailure. */
class FetchFailedError extends Error {
  constructor(
    readonly reason: FetchFailureReason,
    message: string,
  ) {
    super(message);
  }
}

/** The URL to request, without its fragment. Throws for a URL that is never fetched. */
function fetchableUrlOf(url: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new FetchFailedError('invalid_url', `not a valid URL: ${url}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new FetchFailedError('unsupported_scheme', `only http and https are fetched, not ${parsedUrl.protocol}`);
  }
  // Credentials in a URL would be sent to the target; never fetch them.
  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    throw new FetchFailedError('invalid_url', 'URLs with credentials are not fetched');
  }
  parsedUrl.hash = '';
  return parsedUrl;
}

/**
 * Undoes the `Content-Encoding` of a body, which undici leaves as it is. Throws a
 * RangeError when the result is larger than `maxOutputLength`, and an Error for an
 * encoding it does not know. A body cut short at the size cap (`isTruncated`) gives
 * what it holds.
 */
function decodeContentEncoding(
  bodyBytes: Buffer,
  contentEncoding: string | undefined,
  maxOutputLength: number,
  isTruncated = false,
): Buffer {
  // Encodings are listed in the order they were applied, so they are undone in reverse.
  const encodings = (contentEncoding ?? '')
    .split(',')
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding !== '' && encoding !== 'identity')
    .reverse();
  let decoded = bodyBytes;
  for (const encoding of encodings) {
    // Nothing to undo: a 304, an empty page.
    if (decoded.length === 0) return decoded;
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      decoded = gunzipSync(decoded, { maxOutputLength, ...(isTruncated ? { finishFlush: zlib.Z_SYNC_FLUSH } : {}) });
    } else if (encoding === 'deflate') {
      decoded = inflateSync(decoded, { maxOutputLength, ...(isTruncated ? { finishFlush: zlib.Z_SYNC_FLUSH } : {}) });
    } else if (encoding === 'br') {
      decoded = brotliDecompressSync(decoded, {
        maxOutputLength,
        ...(isTruncated ? { finishFlush: zlib.BROTLI_OPERATION_FLUSH } : {}),
      });
    } else {
      throw new Error(`content encoding ${encoding} is not supported`);
    }
  }
  return decoded;
}

/** A file that is itself gzip, whatever its encoding in transit (a `.xml.gz` sitemap). */
function gunzipIfGzipped(bodyBytes: Buffer, maxOutputLength: number): Buffer {
  const isGzip = bodyBytes[0] === 0x1f && bodyBytes[1] === 0x8b;
  return isGzip ? gunzipSync(bodyBytes, { maxOutputLength }) : bodyBytes;
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
