import { chromium, type Browser, type Page, type Request as BrowserRequest, type Route } from 'playwright';
import { Agent, request } from 'undici';
import { DEFAULT_USER_AGENT } from './http-fetcher';
import { readCapped, ResponseTooLargeError } from './read-capped';
import {
  BlockedAddressError,
  buildGuardedConnector,
  publicInternetOnly,
  type HostnameResolver,
  type NetworkPolicy,
} from './ssrf-guard';

// Renders a page in headless Chromium for sites that only have content after JavaScript
// runs.
//
// The browser never touches the network itself. Every request it makes (the document,
// scripts, XHR, iframes, redirects) is intercepted and performed by Node through the
// same guarded connector as the plain HTTP fetcher, then handed back to the browser. So
// the SSRF guard, with its address pinning, covers the browser exactly as it covers the
// HTTP client. As a second layer, the browser's own DNS is disabled, so a request that
// somehow escaped interception could not reach anything. WebSockets and service workers
// are refused.

export interface HeadlessRendererOptions {
  networkPolicy?: NetworkPolicy;
  resolveHostname?: HostnameResolver;
  userAgent?: string;
  /** Total time for one render, waiting for content included. */
  timeoutMs?: number;
  /** Renders running at once across the process; browsers are memory-hungry. */
  maxConcurrentRenders?: number;
  /** Cap on each response the browser receives. */
  maxResponseBytes?: number;
}

export interface RenderedPage {
  kind: 'rendered';
  requestedUrl: string;
  /** The page's URL once rendering settled, after any redirects. */
  finalUrl: string;
  httpStatusCode: number;
  /** Headers of the document response, lowercased names. */
  headers: Record<string, string>;
  /** The rendered DOM, serialised. */
  html: string;
  /** Requests the guard refused while rendering. */
  blockedRequestUrls: string[];
}

export interface RenderFailure {
  kind: 'failed';
  requestedUrl: string;
  reason: 'blocked_address' | 'disallowed_by_robots' | 'unsupported_content_type' | 'timeout' | 'render_error';
  message: string;
  blockedRequestUrls: string[];
}

export type RenderOutcome = RenderedPage | RenderFailure;

export interface RenderOptions {
  /**
   * robots.txt rules for the crawl this render belongs to. Every browser request,
   * redirects included, is checked; a refused request is aborted, and a refused page
   * fails the render with `disallowed_by_robots`.
   */
  isUrlAllowed?: (url: string) => boolean;
}

// Resource types that cannot change the DOM text; skipped to save time and memory.
const SKIPPED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);
// Request and response headers that describe one hop, not the message.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host',
  'content-length',
]);

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

interface NavigationState {
  /** Set when the main frame's response was a redirect: where to navigate next. */
  redirectTarget: string | null;
  /** Set when robots.txt refused the main frame's URL. */
  wasDisallowedByRobots: boolean;
  /** Set when the main frame's response was not an HTML document (a PDF, say). */
  wasNotHtml: boolean;
}

/** How long the page's text must stay the same before it counts as settled. */
const CONTENT_SETTLED_MS = 750;
const CONTENT_POLL_MS = 250;

export class HeadlessRenderer {
  private browser: Promise<Browser> | undefined;
  private readonly dispatcher: Agent;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly renderSlots: Semaphore;

  constructor(options: HeadlessRendererOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
    this.renderSlots = new Semaphore(options.maxConcurrentRenders ?? 2);
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

  async render(url: string, options: RenderOptions = {}): Promise<RenderOutcome> {
    return this.renderSlots.run(() => this.renderNow(url, options.isUrlAllowed ?? (() => true)));
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser !== undefined) await (await browser).close();
    await this.dispatcher.close();
  }

  private launchBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({
      headless: true,
      args: [
        // Belt and braces: the browser resolves no hostname itself. Every request is
        // fulfilled by the interception below, which needs no browser DNS.
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-background-networking',
        '--disable-features=NetworkPrediction',
      ],
    });
    return this.browser;
  }

  private async renderNow(url: string, isUrlAllowed: (url: string) => boolean): Promise<RenderOutcome> {
    const browser = await this.launchBrowser();
    const context = await browser.newContext({
      userAgent: this.userAgent,
      serviceWorkers: 'block',
      acceptDownloads: false,
      javaScriptEnabled: true,
    });
    const blockedRequestUrls: string[] = [];
    const navigation: NavigationState = { redirectTarget: null, wasDisallowedByRobots: false, wasNotHtml: false };
    const deadline = Date.now() + this.timeoutMs;

    try {
      const page = await context.newPage();
      // Only this page may live; window.open and target=_blank pages are closed.
      context.on('page', (popup) => {
        if (popup !== page) void popup.close();
      });
      await page.route('**/*', (route) => this.fulfilFromNode(route, page, navigation, isUrlAllowed, blockedRequestUrls));
      await page.routeWebSocket(/.*/, (webSocket) => webSocket.close());

      // Chromium follows a redirect it was handed by route.fulfill outside interception,
      // so main-frame redirects come back here and are navigated to afresh, which puts
      // every hop back through the guard.
      let navigationUrl = url;
      let response = null;
      for (let redirectCount = 0; ; redirectCount += 1) {
        navigation.redirectTarget = null;
        response = await page.goto(navigationUrl, { waitUntil: 'load', timeout: Math.max(1, deadline - Date.now()) });
        if (navigation.redirectTarget === null) break;
        if (redirectCount >= MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`);
        navigationUrl = navigation.redirectTarget;
      }
      if (response === null) throw new Error('navigation produced no response');
      await waitForContentToSettle(page, deadline);

      return {
        kind: 'rendered',
        requestedUrl: url,
        finalUrl: page.url(),
        httpStatusCode: response.status(),
        headers: response.headers(),
        html: await page.content(),
        blockedRequestUrls,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = navigation.wasDisallowedByRobots
        ? 'disallowed_by_robots'
        : navigation.wasNotHtml
          ? 'unsupported_content_type'
        : /ERR_BLOCKED_BY_CLIENT/.test(message)
          ? 'blocked_address'
          : /timeout/i.test(message)
            ? 'timeout'
            : 'render_error';
      return { kind: 'failed', requestedUrl: url, reason, message, blockedRequestUrls };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Performs one browser request through the guarded HTTP client and hands the response
   * to the browser. Redirects never reach the browser: a main-frame redirect is passed
   * back to `renderNow` to navigate, and any other is followed here, hop by hop, each
   * hop on a new guarded connection.
   */
  private async fulfilFromNode(
    route: Route,
    page: Page,
    navigation: NavigationState,
    isUrlAllowed: (url: string) => boolean,
    blockedRequestUrls: string[],
  ): Promise<void> {
    const browserRequest = route.request();
    if (SKIPPED_RESOURCE_TYPES.has(browserRequest.resourceType())) {
      await route.abort('aborted').catch(() => undefined);
      return;
    }
    const isMainFrameNavigation = browserRequest.isNavigationRequest() && browserRequest.frame() === page.mainFrame();

    let currentUrl = browserRequest.url();
    let method = browserRequest.method();
    let body = browserRequest.postDataBuffer() ?? undefined;
    const headers = await forwardableRequestHeaders(browserRequest);

    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        const parsedUrl = new URL(currentUrl);
        // data: and blob: URLs never reach interception; anything else non-HTTP is refused.
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }
        if (!isUrlAllowed(currentUrl)) {
          if (isMainFrameNavigation) navigation.wasDisallowedByRobots = true;
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }

        const response = await request(parsedUrl, { method: method as 'GET', headers, body, dispatcher: this.dispatcher });
        const location = response.headers['location'];
        if (REDIRECT_STATUS_CODES.has(response.statusCode) && typeof location === 'string') {
          await response.body.dump().catch(() => undefined);
          const target = new URL(location, parsedUrl).href;
          if (isMainFrameNavigation) {
            navigation.redirectTarget = target;
            await route.fulfill({ status: 200, contentType: 'text/html', body: '' });
            return;
          }
          if (redirectCount >= MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`);
          if (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST')) {
            method = 'GET';
            body = undefined;
          }
          currentUrl = target;
          continue;
        }

        if (isMainFrameNavigation && response.statusCode >= 200 && response.statusCode < 300 && !isHtmlResponse(response.headers)) {
          navigation.wasNotHtml = true;
          await response.body.dump().catch(() => undefined);
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }

        await route.fulfill({
          status: response.statusCode,
          headers: forwardableResponseHeaders(response.headers),
          body: await readCapped(response.body, this.maxResponseBytes),
        });
        return;
      }
    } catch (error) {
      if (error instanceof BlockedAddressError) {
        blockedRequestUrls.push(currentUrl);
        await route.abort('blockedbyclient').catch(() => undefined);
        return;
      }
      await route.abort(error instanceof ResponseTooLargeError ? 'failed' : 'connectionfailed').catch(() => undefined);
    }
  }
}

/** A missing Content-Type counts as HTML, as it does for the plain HTTP fetcher. */
function isHtmlResponse(headers: Record<string, string | string[] | undefined>): boolean {
  const contentType = headers['content-type'];
  if (typeof contentType !== 'string') return true;
  const mediaType = contentType.split(';')[0]!.trim().toLowerCase();
  return mediaType === '' || mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
}

async function forwardableRequestHeaders(browserRequest: BrowserRequest): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(await browserRequest.allHeaders())) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || lowerName.startsWith(':')) continue;
    headers[lowerName] = value;
  }
  // undici does not decompress, so ask for an uncompressed body to hand to the browser.
  headers['accept-encoding'] = 'identity';
  return headers;
}

function forwardableResponseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === 'content-encoding') continue;
    forwarded[lowerName] = Array.isArray(value) ? value.join(lowerName === 'set-cookie' ? '\n' : ', ') : value;
  }
  return forwarded;
}

/**
 * Waits until the page has stopped changing: network idle, then the body text the same
 * for `CONTENT_SETTLED_MS`. Network idle alone misses content fetched after a timer.
 */
async function waitForContentToSettle(page: Page, deadline: number): Promise<void> {
  const remaining = () => Math.max(0, deadline - Date.now());
  await page.waitForLoadState('networkidle', { timeout: Math.min(remaining(), 5_000) }).catch(() => undefined);

  let lastText = '';
  let unchangedSince = Date.now();
  while (remaining() > 0) {
    // A string, because this package is compiled without the DOM types.
    const text = await page.evaluate<string>('document.body ? document.body.innerText : ""').catch(() => lastText);
    if (text !== lastText) {
      lastText = text;
      unchangedSince = Date.now();
    } else if (Date.now() - unchangedSince >= CONTENT_SETTLED_MS) {
      return;
    }
    await page.waitForTimeout(Math.min(CONTENT_POLL_MS, remaining()));
  }
}

/** Limits how many renders run at once. */
class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(slots: number) {
    this.available = slots;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.available > 0) this.available -= 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next !== undefined) next();
      else this.available += 1;
    }
  }
}
