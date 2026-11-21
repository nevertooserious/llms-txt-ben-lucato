# System design

A web app that takes a website URL, generates an [llms.txt](https://llmstxt.org) for it, and keeps that file up to date as the site changes.

Status: the extractor, the crawler, the run lifecycle, the worker's run of the stages, the generator and the monitor's scheduling are implemented. The generator's LLM calls are wired in behind `ANTHROPIC_API_KEY`, but have not yet run against the live API; without a key the worker uses heuristics (see the [root README](../../README.md)). The schema in [`db/schema.sql`](../../db/schema.sql) is applied to Postgres 14 in CI on every PR ([`scripts/validate-schema.sh`](../../scripts/validate-schema.sh)).

## Contents

1. [System shape](#1-system-shape)
2. [Pipeline stages](#2-pipeline-stages)
3. [Data model](#3-data-model)
4. [Queueing and recovery](#4-queueing-and-recovery)
5. [Monitor](#5-monitor)
6. [Frontend](#6-frontend)
7. [Security and abuse limits](#7-security-and-abuse-limits)
8. [llms.txt output rules](#8-llmstxt-output-rules)
9. [Deliberately left out](#9-deliberately-left-out)
10. [Open questions](#10-open-questions)

## 1. System shape

![System overview](diagrams/system-overview.svg)

Two processes and one database.

- **Web app:** the UI, the API, and the hosted `llms.txt` URL.
- **Worker:** runs the pipeline. Crawls take seconds to minutes, so they cannot live in a request handler.
- **Postgres:** the only stateful piece. It holds the tables and, through pg-boss, the job queue. The web app and worker never call each other directly.

The five components are the crawler, extractor, generator, monitor and frontend. The monitor has no pipeline of its own: it puts check jobs on the same queue, and they run through the same three stages as a first-time generation.

Stack: TypeScript throughout, Next.js for the web app, a Node worker with Playwright as the headless fallback, pg-boss for the queue, and node-postgres with hand-written SQL. Hosting is not decided; the proposal is Railway or Fly, as a web service, a worker service and Postgres.

## 2. Pipeline stages

![Pipeline contracts](diagrams/pipeline-contracts.svg)

Each stage has one typed input and one typed output, so each can be tested alone with fixtures.

A run is driven by the worker (`apps/worker/src/pipeline-stages.ts`) as load, decide, write. It loads the site and its stored pages, runs the stages, passes their output through pure decision functions, and saves what those return. The rules that are easiest to get wrong are those functions, tested without a database: `reconcilePage` (what a fetch does to a stored page, section 5), `evaluateSafetyGate`, `assessSitemapLastModifiedTrust` (in `packages/monitor`) and `decidePublication` (in `packages/generator`). Extraction happens inside the crawl: each page is extracted and saved as the crawler hands it over. So the UI states one of: queued, crawling, extracted (the crawl is done and the file is being generated), generated, or failed.

### Crawler

Owns all network I/O. It hands each fetched page (404s, 410s and 304s included, since the monitor needs them) to an `onPage` callback as soon as it has it, and waits for the callback, so the worker extracts and stores the page and the HTML is not held for the rest of the crawl. Then it returns a `CrawlResult`: the link signals that are only final once the crawl ends (navigation membership, inbound link counts), the fetches that failed with a typed reason (timeouts, 5xx, 429s, blocks), the robots.txt status, why the crawl stopped, and the site's rendering decision.

- **Root URL:** before a site's first crawl, the worker follows the homepage's redirect (`resolveSiteRootUrl`), obeying robots.txt. A move to another origin (`example.com` to `www.example.com`, `http` to `https`) becomes the site's `root_url`. If another row already holds that root, the workspaces and the run move to it, so both addresses share one crawl.
- **Discovery:** robots.txt, sitemaps, any existing llms.txt, and homepage navigation seed a prioritised breadth-first crawl under a page budget. Sitemaps come from robots.txt's `Sitemap:` lines, else `/sitemap.xml`, in every format the sitemaps protocol allows: XML, gzipped XML, plain text, RSS and Atom, up to 50 MB each. At most 10 sitemap files are read, and at most four sitemap URLs are kept per page of budget. llms.txt is looked for under the root URL, then at the host root. Its links usually point at `.md` variants, so they are mapped back to the HTML page. Within a depth, navigation links come first, then llms.txt, then sitemap, then other page links.
- **Conventions first:** where an open convention covers a behaviour (RFC 9309 for robots.txt, the sitemaps protocol, RFC 9110 for status codes and `Retry-After`, RFC 3986 for URLs, robots meta tags and `X-Robots-Tag`), the crawler follows it, and the choices below only fill the gaps.
- **Known pages:** the worker passes the site's stored pages back in. Each is queued alongside what discovery finds, so a page nothing links to any more is still re-checked and its 404 is seen. A known page with an ETag or Last-Modified is fetched with a conditional GET, and a 304 is passed on with an empty body. On a site whose sitemap `lastmod` is trusted, a known page whose `lastmod` has not moved is not requested at all. The homepage is always fetched in full, because discovery starts from its links.
- **Which URL is requested:** the URL as the site linked it, with only RFC 3986's safe normalisation, and fragment and tracking parameters dropped. Rows are keyed on the more aggressive normalised URL (section 3), so `/about` and `/about/` are one page, but the crawler never requests a form the site did not link. The requested form is stored as `pages.fetch_url`, and a re-check asks for it.
- **Fetching, per site:** plain HTTP by default. On a site's first crawl the homepage is fetched both ways and compared, by visible text length and link count. If the browser finds much more (at least 200 more characters and 1.5 times the text, or 5 more links), every page of the site is rendered. A homepage with no executable script skips the comparison. The answer is stored in `sites.requires_headless_rendering` and re-decided after 30 days.
- **Fetching, per page:** on a site that does not need rendering, a page whose plain HTML is empty, or holds an empty app mount point such as `<div id="root">`, is rendered anyway. The rendered version is kept only if it shows more. This catches a client-rendered section of a server-rendered site. The crawler reads these signals itself, with a shallow parse, so it does not depend on the extractor.
- **Headless browser:** Chromium never touches the network. Every request it makes is intercepted and performed by Node through the same guarded connector as plain HTTP. Redirects are followed in Node too, because Chromium follows a redirect handed to it by interception without intercepting the next hop. See [Security](#7-security-and-abuse-limits). Rendering waits for network idle, then for the page text to stop changing, which catches content loaded after a timer.
- **robots.txt (RFC 9309):** rules for this crawler's token (`LlmsTxtGenerator`), else `*`. A 2xx robots.txt is parsed whatever its media type, up to its first 500 KiB. A 4xx, or more than five redirects, allows everything. A 5xx or an unreachable robots.txt means complete disallow: nothing else on the site is fetched, and the result says `robots_txt_unreachable` so the run can fail with that reason. The rules apply to every request the crawler makes on the site: pages, redirect targets, guessed sitemap and llms.txt locations, `.md` probes, and the headless browser's own requests. A redirect into a disallowed path is skipped, not counted as a failure. Not yet covered: other hosts' robots.txt files are not fetched, so the browser's requests to a CDN and a redirect target on another host are made without checking them.
- **Robots directives:** `nofollow` and `noindex` from `<meta name="robots">`, `<meta name="LlmsTxtGenerator">` and `X-Robots-Tag` (unscoped, or scoped to this crawler). `nofollow` stops link discovery from that page. `noindex` is passed on as `has_noindex_directive`, and the generator leaves the page out.
- **Politeness:** requests to a site are sequential and at least 500 ms apart, or `Crawl-delay` apart if robots.txt sets one, honoured as given. A run stops taking new pages after 15 minutes, so a slow site gets fewer pages, not faster requests. A wait that would end past that limit stops the crawl instead of sleeping through it. A 429, or a 503 with `Retry-After`, is retried once after the wait (RFC 9110) when that is 30 seconds or less, and slows the rest of the crawl.
- **User agent:** `LlmsTxtGenerator/0.1`, whose product token is the one robots.txt groups match. By convention it should also link a page that explains the crawler; the worker should add that once the app is hosted.
- **Markdown variants:** probes for a `.md` version of each page (`index.html.md` for a URL without a file name), which the spec recommends linking in preference to HTML. Probing stops after three misses on a site that has none.
- **Scope:** only URLs under the site's `root_url`, on a path segment boundary.
- **Known limitation:** hash-routed sites (`/#/docs`) are one page to the crawler, because fragments are dropped in normalisation and never reach the server.

### Extractor

A pure function from HTML to a `PageRecord`. No I/O, so it is tested against saved HTML fixtures.

- **Title:** Open Graph title, then the title tag, then the first H1.
- **Description:** meta description, then Open Graph description, then the first paragraph.
- **Page type:** one of `home`, `docs`, `api`, `guide`, `blog`, `product`, `pricing`, `about`, `legal`, `other`.
- **Language and canonical URL:** from `<html lang>` and `<link rel="canonical">`.
- **Page type rules:** the first URL path segment (or subdomain, as in `docs.`) that names a section decides; a docs section is narrowed by a later `api` or `guide` segment. Only when the URL says nothing do `og:type` and JSON-LD types count.
- **Content:** `<main>`, else the only top-level `<article>`, else the smallest element holding 80% of the page's prose (which finds content in client-rendered `<div>` markup), else `<body>` without nav, header, footer and aside. Converted to markdown with links made absolute against the final URL.
- **Hashes:** `content_digest` and `listing_fields_hash`, described under [Monitor](#5-monitor).

### Generator

- **Selection:** the file lists durable, structural pages that explain the site and how to use it, not its stream of content. Three steps. Deterministic filters first, so nothing is paid for pages that cannot be listed: the homepage (it is the H1), `noindex` pages, pagination (`/page/2`, `?page=2`), and pages whose declared language differs from the homepage's (locale duplicates such as `/de/`). Then the page assessment (below) and workspace exclusions remove what does not belong. Last, pages are scored on navigation presence, crawl depth and inbound links (plus a lift for pages the site's own llms.txt lists), and one page per canonical URL is kept. Ties are broken by URL, comparing digit runs as numbers.
- **Page assessment:** Claude Haiku reads each candidate page and returns a one-line description, a listing value (`primary`, `optional` or `exclude`), a reason for any exclusion (`error_page`, `utility`, `thin`, `archive`, `individual_content`, `duplicate`) and a corrected page type. So a "not found" page served with a 200, a login page or a single blog post is left out. The model is told to choose `optional` when unsure.
- **Sections:** derived from the assessed page type (the extractor's when there is no assessment), in a fixed order: Docs, API, Guides, Product, Pricing, About, Blog, Pages (for `other`). The LLM picks among these types but cannot create a section. `optional` and legal pages go under `Optional`.
- **Limits:** at most 15 entries per section, 5 for Blog, and 60 outside `Optional`; the overflow goes under `Optional`, which holds at most 40. A flood of blog posts therefore cannot crowd out core pages. Starting values, in `packages/generator/src/select-pages.ts`.
- **Entries:** the `.md` variant when there is one, else the URL as the site links it. The site name is dropped from titles (`Docs | Acme` becomes `Docs`), a page with no title gets one from its URL, and descriptions are cut to 300 characters.
- **Site summary:** Claude Opus writes it from the homepage and the listed pages. It is rewritten only when the homepage's title or description, or the titles of listed navigation pages, change, and the model is given its previous summary and told to keep the wording unless something is now wrong. So a new blog post does not reword it.
- **LLM caching:** both results are stored against a hash of their inputs (including the model and prompt version) and never requested again for unchanged inputs, because an LLM words the same thing differently each time.
- **LLM failures:** the SDK retries transient errors. If the API is still unavailable, a page with an older assessment or a site with an older summary keeps it. A new page cannot be judged without one, so the run fails and the published file stays. A page the model refuses or answers unusably is left out and tried on the next run. Page text is passed as untrusted data, and output is forced to one line of plain text with links and markdown removed.
- **No API key:** for local development and tests only, the worker skips the LLM: every candidate page is listed with its own description, and the summary is the homepage's description.
- **Rendering:** deterministic, followed by validation against the spec. Output that fails validation is a bug, so it fails the run rather than being published.
- **Per workspace:** the file is rendered once per workspace, applying that workspace's overrides.

Still open: a site whose pages declare no language gets no locale filtering, and very large sites are only bounded by the page budget and the limits above.

## 3. Data model

![Data model](diagrams/data-model.svg)

The full DDL with comments is in [`db/schema.sql`](../../db/schema.sql).

| Table | Holds | Mutability |
|---|---|---|
| `sites` | One crawled website: root URL, cached summary, monitor schedule | Updated in place |
| `site_workspaces` | One submission of a site: access token, hosted slug, published version | Updated in place |
| `pages` | Current state of each known URL of a site | Updated in place |
| `workspace_page_overrides` | A workspace's edits to individual pages | Updated in place |
| `pipeline_runs` | One execution of crawl, extract, generate for a site | Written during the run, then fixed |
| `llms_txt_versions` | Every published llms.txt of a workspace | Append-only |

### Design choices

- **Crawl state is shared, ownership is not.** A site has many workspaces. A second person submitting the same site reuses the crawl and gets their own workspace, token and overrides.
- **No user accounts.** Each submission returns a secret link containing a random token. Holding the link authorises editing that workspace. Only the token's SHA-256 is stored.
- **Column groups in `pages` have one writer each.** Crawler, extractor and generator each own a set of columns, so a stage can be re-run without clobbering another's output.
- **User edits are stored as inputs.** Overrides are applied by the generator on every run, so an edit survives regeneration. Only the description and an exclude flag can be overridden.
- **Rows are keyed on the normalised URL.** That is the URL after cleanup that needs no fetch: lowercase host, fragment and tracking parameters removed, query sorted, trailing slash stripped. The canonical URL a page declares is only known after fetching, so it is stored as a plain column and used to drop duplicates at selection.
- **Publishing is a single pointer update.** A version becomes live when `site_workspaces.published_version_id` moves to it. Rollback is the same operation.
- **Raw HTML is not stored.** Only extracted markdown and hashes are kept. Improving the extractor means re-fetching pages.

### Where SQL lives

All SQL is hand-written in `packages/db`, one module per table, and the rest of the code calls its functions. ESLint stops any other package from importing `pg`, and stops contracts, the extractor, the generator and the crawler from importing the database at all: the worker loads their inputs and stores their outputs. A function whose writes must land with the caller's takes a `Transaction`, which only `withTransaction` produces, so it cannot be called on a bare pool by mistake.

## 4. Queueing and recovery

- **One job is one site's run.** Jobs are not split per page.
- **Concurrency:** the worker takes up to ten jobs at once, so ten sites run in parallel. Within a run, the target site is fetched at a per-host rate limit. Headless rendering has its own, lower, global limit because of memory: the worker shares one `HeadlessRenderer`, which runs at most two renders at once.
- **Priority:** a user's submission or "check now" is taken ahead of scheduled monitor checks.
- **One active run per site:** a partial unique index on `pipeline_runs` rejects a second queued or running run for the same site. A second submission joins the active run instead. A run ends in a transaction that locks the site row and first checks for workspaces it has not rendered, so a submission that joined late still gets its file.
- **A run and its job are created together:** the `pipeline_runs` row is inserted and the pg-boss job sent in one transaction, through pg-boss's `db` option, and the job's id is the run's id. A crash can therefore never leave a queued row with no job, which would hold the site's slot for good. The web app and the monitor both go through one function, `startPipelineRun`, so priorities and queue options are set in one place.
- **Guarded status changes:** `queued → running → succeeded | unchanged | failed`, and `queued | running → failed` by the reaper. Every change is a conditional update that names the status it expects. A job that cannot claim its run (already claimed, or reaped) is dropped. A worker that finishes after its run was reaped records nothing, and publishing first locks the run row and checks that the run is still running.
- **Heartbeat:** a running job updates `last_heartbeat_at` every 5 seconds.
- **Reaper:** every monitor tick, fails running rows whose heartbeat is over 2 minutes old and queued rows over 6 hours old (a job that failed or expired before it was claimed). Either frees the site for a new run.
- **No queue-level retries:** pipeline-run jobs have `retryLimit: 0`. A retried job would find its run already failed by the reaper, so retries would only add a second recovery path that disagrees with the first. A failed run is retried by the next monitor check or by the user. pg-boss expiry (45 minutes, well past the longest run) only cleans up after a worker that died.

`pipeline_runs` is the record of a run: its status and stage, which the frontend polls, and counters for the audit log. pg-boss only decides when and where a job runs.

## 5. Monitor

![Monitor check](diagrams/monitor-check.svg)

A check runs on a fixed interval per site (default 7 days) or when a user presses "check now". A site is only scheduled while at least one of its workspaces has unexpired monitoring.

### Scheduling

The monitor only acts on a schedule. A request to check now arrives over HTTP, so the web app takes it and queues the run itself, through the same `startPipelineRun`. The two never call each other.

- **Starting and renewing:** every submission turns monitoring on for 30 days and users cannot turn it off. "Check now" renews it for 30 days, including after it has lapsed. If the site has no check scheduled, it gets one a full interval out: the site was just crawled, so checking sooner would find nothing.
- **Deleting a workspace:** removes its overrides, versions and hosted file. The site stays scheduled while another of its workspaces is monitoring. Its row and crawl data are deleted with its last workspace, unless a run is active, in which case the unscheduled row stays. A run skips a workspace deleted while it was generating. The delete locks the site row first (`deleteWorkspace` in `packages/db/src/workspaces.ts`).
- **The tick:** every 5 minutes, a pg-boss cron job in the worker reaps stale runs (section 4). Then it claims up to 100 due sites, skipping rows another tick has locked, moves each one's next check on by its interval, and queues a monitor run behind user requests. A due site whose workspaces have all let monitoring lapse is unscheduled at that point, so expiry needs no job of its own.
- **Check now:** the same pipeline as a scheduled check, queued ahead of scheduled checks. A run already in progress is joined. Otherwise the site is checked at most once per 5 minutes, counted from its last run of any kind.

### Change detection

Discovery runs on every check to find new URLs. Then every known page is checked by the first method it supports:

| Order | Method | Used when | Cost per page |
|---|---|---|---|
| 1 | Sitemap `lastmod` | The site's `lastmod` has proved reliable (`sites.sitemap_lastmod_is_trusted`) | No request |
| 2 | Conditional GET | The page has a stored ETag or Last-Modified | One small request |
| 3 | Fetch and hash | Neither of the above | One full request |
| 4 | Headless render and hash | The page only has content after JavaScript runs | One browser render |

### What counts as a change

The change signal is `listing_fields_hash`: a hash of what feeds the page's llms.txt entry. That is the extracted title and description plus `content_digest`, because the entry's description is written from the content. `content_digest` hashes headings and body text with dates, numbers and whitespace stripped, so "updated 3 days ago" is not a change.

### Pages that go missing

| What the check sees | What happens |
|---|---|
| The page's URL returns 404 or 410 once | `consecutive_not_found_count` becomes 1; the page stays listed |
| It returns 404 or 410 on the next check too | `removed_at` is set and the page is dropped from the file; the row is kept so overrides survive |
| It still loads but is gone from the sitemap and navigation | Not removed; the score computed at selection falls, so it may move to `## Optional` or below the cut-off |
| The fetch fails (timeout, 5xx, blocked) | The stored row is reused; the failure counts toward the safety gate |
| A removed page returns 200 again | The counter resets, `removed_at` is cleared, and it is listed again |

A page is never removed because a crawl failed to reach it.

### Safety gate

Failed fetches include errors, blocks (401, 403, 451) and bot-challenge pages. If they are over half of the run's fetches, or nothing could be fetched, or no page returned content (a site-wide 404, say), or robots.txt was unreachable, the run fails and the published version is left alone. Pages fetched successfully are saved as they arrive, because those facts hold either way. 404 and 410 responses are held back until the run passes the gate, so a failed run never counts toward removing a page.

### Trusting sitemap `lastmod`

A page fetched in full that has both an old and a new `lastmod`, and an old and a new content digest, is one observation. A single page whose content changed while its `lastmod` did not withdraws trust. Trust is given once a run has at least five observations, no misses, and at least one content change that its `lastmod` flagged.

### Publishing

Entries are regenerated only for changed pages. The file is rendered per workspace, and a new version is written only where the text differs from that workspace's published version.

## 6. Frontend

- **Generate:** URL input, then the run's status polled from `pipeline_runs`: crawling, extracted, generated.
- **Result:** rendered preview next to raw text, spec validation status, copy and download.
- **Editing:** override a page's description or exclude a page.
- **Secret link:** `/w/{public_slug}#token=…`. The token is in the fragment, which browsers never send, and the browser keeps the links it created so the home page can list them.
- **API:** `POST /api/sites` submits a URL. `GET /api/workspaces/{public_slug}` is what the workspace screen polls: the latest run, the published file with its validation result, and monitoring. `DELETE /api/workspaces/{public_slug}` deletes the workspace. `POST /api/workspaces/{public_slug}/checks` is "check now" and renews monitoring. The workspace routes take the secret link's token as `Authorization: Bearer <token>`, which keeps it out of request URLs and the logs that record them.
- **Hosted URL:** a stable `/w/{public_slug}/llms.txt`. The spec puts llms.txt at the site's own root, so the site owner redirects or proxies to this URL. The [root README](../../README.md#serving-llmstxt-from-your-own-domain) explains how.
- **Monitoring:** on for every workspace with an expiry, a "check now" button that renews it, and version history with diffs.

## 7. Security and abuse limits

The app is public, has no accounts, and fetches URLs that users supply.

- **SSRF guard:** blocks private, loopback and link-local addresses, including IPv6 and IPv4-mapped forms and the hosting platform's private network. It runs inside the HTTP client's connector: the host is resolved there, every address is checked, and the socket connects to the checked address, so there is no second lookup for DNS rebinding to exploit. A host with any blocked address is refused. Redirects are followed by hand, and each hop opens a new, checked connection. It covers the headless browser by performing every browser request in Node through the same connector. As a second layer, the browser's own DNS is disabled, so a request that escaped interception could not reach anything. WebSockets, service workers and popups are refused.
- **Network policy:** the guard's rule is passed in when the fetcher is created. Production uses the public-internet-only policy. End-to-end tests pass one that allows only their fixture sites' loopback ports; it lives in the tests, and no setting or environment variable can loosen the guard.
- **Fetch limits:** 15 seconds per fetch including redirects, 5 MB per response, 5 redirects, and only `http` and `https`; a page budget per run. A response of a type the caller did not ask for is dropped without reading its body.
- **Submission limits:** a per-IP rate limit using `site_workspaces.creator_ip_hash` (10 new workspaces per hour by default), and a global concurrency cap from the queue. The IP is read from the right of `X-Forwarded-For`, counting back `TRUSTED_PROXY_HOPS` entries (default 1), because a client can put anything in the entries to the left. This needs the app to sit behind the hosting platform's proxy.
- **Monitor expiry:** `monitoring_enabled_until` stops abandoned submissions from being re-crawled forever.
- **Check-now cooldown:** a site is checked by hand at most once per 5 minutes, so one secret link cannot keep a site under constant crawling. The active-run index already stops parallel crawls, but not back-to-back ones.
- **Served files:** `text/plain` with `X-Content-Type-Options: nosniff`.
- **Preview:** crawled titles and descriptions are untrusted and are escaped before display.

## 8. llms.txt output rules

Checked against llmstxt.org.

- **Order:** H1 with the site name (the only required part), a blockquote summary, optional body text with no headings, then H2 sections of links.
- **Headings:** only H1 and H2. No H3 sub-grouping.
- **Entries:** `- [title](url): description`, each on one line.
- **Escaping:** square brackets in titles are escaped, newlines are stripped, parentheses in URLs are encoded, and LLM output is forced to a single line.
- **Optional section:** lower-priority pages go under an H2 named exactly `Optional`, which the spec defines as skippable.
- **Markdown links:** where a page has a `.md` variant, the entry links that.

## 9. Deliberately left out

| Left out | Why |
|---|---|
| User accounts | A secret link per workspace covers editing without the work of auth |
| Webhook and email notifications | Both are open relays on an app without accounts |
| Adaptive check interval | A fixed interval plus "check now" is simpler and easier to demonstrate |
| `llms-full.txt` | Not found in the spec; it would duplicate large content per version |
| Server-sent events | Polling `pipeline_runs` is enough for run status |
| LLM-invented sections, and title, summary and section overrides | Sections are a fixed list that the assessed page type maps to; overrides are limited to description and exclude |
| Raw HTML storage | Saved fixtures cover extractor testing |
| A separate queue broker | pg-boss in Postgres handles this load without another service |

## 10. Open questions

Not yet decided or designed.

- **Hosting:** Railway or Fly is proposed, not decided.
- **Update notifications from sites:** a site cannot yet tell us it changed (from a deploy hook, say). Proposal: a web-app route that does what "check now" does, authorised by the workspace token and held to the same cooldown. The monitor would not change.
- **Redirects:** a page that now returns a permanent redirect is not handled, and neither is a site with stored pages whose homepage moves to another origin (its runs fail and the published file stays). Proposal: treat it as an immediate removal of the old URL and add the target as a page if it is in scope. Needs one new column on `pages` for the redirect target.
- **Soft 404s:** sites that answer a deleted URL with 200 and a "not found" body are not handled. Proposal: an extractor check that counts the same as a real 404.
- **Slow removal:** with a 7-day interval, waiting for two checks can leave a dead link in the file for two weeks. Proposal: schedule a follow-up check 24 hours after any run that sees a first 404.
- **Stale sitemap:** if `lastmod` is trusted and a deleted page is still listed with an unchanged date, no request is made and the deletion is missed.
- **Page selection:** the rules in section 2 are a first cut; locale duplicates without a declared language, the limits and the assessment prompt are untested against real sites.
- **Restoring an excluded page:** a user cannot yet force back a page the assessment wrongly excluded.
- **Partial link counts:** a page answered with a 304, or skipped because of a trusted `lastmod`, has no body, so its links are not seen. On such runs, inbound link counts and the frontier miss those links.
- **Thresholds:** the page budget (200, `CRAWL_PAGE_BUDGET`) and the safety-gate failure share (0.5) have starting values that have not been tuned against real sites. The headless thresholds have starting values in `packages/crawler/src/render-decision.ts`, tuned only against the fixture sites.
