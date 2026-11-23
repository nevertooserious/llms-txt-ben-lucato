import type { FetchMethod, KnownPage } from '@llms-txt/contracts';
import { isInScope } from '../discovery/normalise-url';
import { HeadlessRenderer, type RenderFailure } from '../network/headless-renderer';
import type { FetchRequest } from '../network/http-fetcher';
import type { HostnameResolver, NetworkPolicy } from '../network/ssrf-guard';
import { looksLikeBotChallenge } from '../page-signals/detect-bot-challenge';
import { readPageSignals, type PageSignals } from '../page-signals/read-page-signals';
import { looksLikeJavaScriptShell, renderedPageIsBetter, renderingAddsContent } from '../page-signals/render-decision';
import { isErrorStatus, type CrawlFailureLog } from './crawl-failures';
import type { FrontierEntry } from './frontier';
import { HTML_TYPES, isSuccessStatus } from './media-types';
import type { PoliteFetcher } from './polite-fetcher';
import type { RobotsGate } from './robots-gate';

export interface FetchedPage {
  finalUrl: string;
  httpStatusCode: number;
  headers: Record<string, string>;
  html: string;
  fetchMethod: FetchMethod;
}

export interface PageFetcherOptions {
  rootUrl: string;
  politeFetcher: PoliteFetcher;
  robots: RobotsGate;
  failures: CrawlFailureLog;
  /** Pages stored from earlier crawls, whose validators make a fetch conditional. */
  knownPages: ReadonlyMap<string, KnownPage>;
  /** What an earlier crawl decided; null leaves it to this crawl's homepage. */
  requiresHeadlessRendering: boolean | null;
  /** A renderer shared across crawls. When absent, one is made when first needed and closed at the end. */
  headlessRenderer?: HeadlessRenderer;
  networkPolicy?: NetworkPolicy;
  resolveHostname?: HostnameResolver;
}

/**
 * Fetches a page the way the site needs: plain HTTP by default, headless rendering for
 * the whole site when the homepage comparison says so, and for single pages whose plain
 * HTML is an empty JavaScript shell.
 */
export class PageFetcher {
  /** Null until the homepage has been fetched both ways, or an earlier crawl's answer. */
  requiresHeadlessRendering: boolean | null;
  /** robots.txt disallows the homepage or a redirect on the way to it. */
  homepageIsDisallowedByRobots = false;
  private renderer: HeadlessRenderer | undefined;
  private readonly ownsRenderer: boolean;

  constructor(private readonly options: PageFetcherOptions) {
    this.requiresHeadlessRendering = options.requiresHeadlessRendering;
    this.renderer = options.headlessRenderer;
    this.ownsRenderer = options.headlessRenderer === undefined;
  }

  /** Fetches one page. Null when there is nothing to keep. */
  async fetch(entry: FrontierEntry): Promise<FetchedPage | null> {
    if (this.requiresHeadlessRendering === true) {
      return this.render(entry.fetchUrl, { isHomepage: entry.crawlDepth === 0 });
    }
    const plainPage = await this.fetchPlain(entry);
    if (plainPage === null || !isSuccessStatus(plainPage.httpStatusCode)) return plainPage;
    if (looksLikeBotChallenge(plainPage.html, plainPage.headers)) {
      const message = 'The response was a bot-challenge page.';
      this.options.failures.record(entry.fetchUrl, 'bot_challenge', message, plainPage.httpStatusCode);
      return null;
    }
    return this.renderedIfBetter(entry, plainPage);
  }

  async render(url: string, { recordFailure = true, isHomepage = false } = {}): Promise<FetchedPage | null> {
    const { failures, politeFetcher, robots } = this.options;
    this.renderer ??= new HeadlessRenderer({
      networkPolicy: this.options.networkPolicy,
      resolveHostname: this.options.resolveHostname,
    });
    await politeFetcher.waitForRequestSlot();
    // The browser's requests to this host obey robots.txt too, as a crawler's should.
    const outcome = await this.renderer.render(url, { isUrlAllowed: robots.isRedirectAllowed });
    if (outcome.kind === 'failed') {
      this.noteRenderFailure(url, outcome, { recordFailure, isHomepage });
      return null;
    }
    if (isErrorStatus(outcome.httpStatusCode)) {
      if (recordFailure) failures.recordErrorStatus(url, outcome.httpStatusCode);
      return null;
    }
    if (isSuccessStatus(outcome.httpStatusCode) && looksLikeBotChallenge(outcome.html, outcome.headers)) {
      if (recordFailure) failures.record(url, 'bot_challenge', 'The rendered page was a bot-challenge page.', outcome.httpStatusCode);
      return null;
    }
    return {
      finalUrl: outcome.finalUrl,
      httpStatusCode: outcome.httpStatusCode,
      headers: outcome.headers,
      html: outcome.html,
      fetchMethod: 'headless_browser',
    };
  }

  async close(): Promise<void> {
    if (this.ownsRenderer) await this.renderer?.close();
  }

  private noteRenderFailure(
    url: string,
    outcome: RenderFailure,
    { recordFailure, isHomepage }: { recordFailure: boolean; isHomepage: boolean },
  ): void {
    if (isHomepage && outcome.reason === 'disallowed_by_robots') this.homepageIsDisallowedByRobots = true;
    // Not an HTML page, or a path robots.txt disallows: not a failure of the site.
    if (outcome.reason === 'disallowed_by_robots' || outcome.reason === 'unsupported_content_type') return;
    if (recordFailure) this.options.failures.record(url, outcome.reason, outcome.message);
  }

  /** The page over plain HTTP, whatever its status. Null when the fetch failed or the site refused it. */
  private async fetchPlain(entry: FrontierEntry): Promise<FetchedPage | null> {
    const { failures, politeFetcher, robots } = this.options;
    const outcome = await politeFetcher.fetch({
      url: entry.fetchUrl,
      acceptedContentTypes: HTML_TYPES,
      isRedirectAllowed: robots.isRedirectAllowed,
      ...this.conditionalRequestHeaders(entry),
    });
    if (outcome.kind === 'failed') {
      // Not an HTML page, or a redirect into a disallowed path: not part of the site's
      // llms.txt, and not a failure of the site either.
      if (outcome.reason === 'disallowed_by_robots' && entry.crawlDepth === 0) this.homepageIsDisallowedByRobots = true;
      if (outcome.reason === 'unsupported_content_type' || outcome.reason === 'disallowed_by_robots') return null;
      failures.record(entry.fetchUrl, outcome.reason, outcome.message);
      return null;
    }
    if (failures.recordErrorStatus(entry.fetchUrl, outcome.httpStatusCode)) return null;
    return {
      finalUrl: outcome.finalUrl,
      httpStatusCode: outcome.httpStatusCode,
      headers: outcome.headers,
      html: outcome.body,
      fetchMethod: 'plain_http',
    };
  }

  /** The rendered page in place of a plain one that scripts would add content to. */
  private async renderedIfBetter(entry: FrontierEntry, plainPage: FetchedPage): Promise<FetchedPage> {
    const plainSignals = signalsOf(plainPage);
    if (!plainSignals.hasScripts) {
      // Without scripts, rendering cannot add anything.
      this.requiresHeadlessRendering ??= false;
      return plainPage;
    }
    // The first page fetched is the homepage: compare the two ways once, for the site.
    if (this.requiresHeadlessRendering === null) return this.decideRenderingForSite(entry, plainPage, plainSignals);

    // The per-page safety net on a site that is otherwise server-rendered.
    if (!looksLikeJavaScriptShell(plainSignals)) return plainPage;
    const renderedPage = await this.render(entry.fetchUrl, { recordFailure: false });
    if (renderedPage === null) return plainPage;
    return renderedPageIsBetter(plainSignals, signalsOf(renderedPage)) ? renderedPage : plainPage;
  }

  private async decideRenderingForSite(
    entry: FrontierEntry,
    plainPage: FetchedPage,
    plainSignals: PageSignals,
  ): Promise<FetchedPage> {
    const renderedPage = await this.render(entry.fetchUrl, { recordFailure: false });
    if (renderedPage === null) {
      this.requiresHeadlessRendering = false;
      return plainPage;
    }
    const isInSite = (url: string) => isInScope(url, this.options.rootUrl);
    this.requiresHeadlessRendering = renderingAddsContent(plainSignals, signalsOf(renderedPage), isInSite);
    return this.requiresHeadlessRendering ? renderedPage : plainPage;
  }

  /**
   * Validators from the last fetch, so a page that has not changed answers 304. Not sent
   * for the homepage, nor for a page whose links were never read.
   */
  private conditionalRequestHeaders(entry: FrontierEntry): Pick<FetchRequest, 'ifNoneMatch' | 'ifModifiedSince'> {
    const knownPage = this.options.knownPages.get(entry.url);
    if (knownPage === undefined || knownPage.outboundLinkUrls === null || entry.crawlDepth === 0) return {};
    return {
      ...(knownPage.httpEtag !== null && { ifNoneMatch: knownPage.httpEtag }),
      ...(knownPage.httpLastModified !== null && { ifModifiedSince: knownPage.httpLastModified }),
    };
  }
}

function signalsOf(page: FetchedPage): PageSignals {
  return readPageSignals(page.html, page.finalUrl, page.headers);
}
