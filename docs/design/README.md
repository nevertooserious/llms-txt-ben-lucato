# System design

## System overview

```mermaid
flowchart LR
  browser["<b>browser</b><br/>frontend"]
  web["<b>web app</b><br/>UI + API, serves llms.txt"]
  site(["<b>target website</b>"])
  claude(["<b>Claude API</b><br/>Haiku and Opus"])

  subgraph postgres["Postgres"]
    tables[("<b>tables</b><br/>sites, pages, versions")]
    queue[("<b>job queue</b><br/>pg-boss")]
  end

  subgraph worker["worker process: one job = one site run"]
    crawler["<b>crawler</b><br/>discover + fetch"]
    extractor["<b>extractor</b><br/>HTML to record"]
    generator["<b>generator</b><br/>records to llms.txt"]
    monitor["<b>monitor</b><br/>due checks + stale-run reaper"]
    crawler -- "pages" --> extractor
    extractor -- "records" --> generator
  end

  browser -- "submit, poll" --> web
  web -- "status, file" --> browser
  web <-- "read, write" --> tables
  web -- "enqueue run" --> queue
  queue -- "up to 10 runs at once" --> crawler
  monitor -- "enqueue due checks" --> queue
  crawler -- "GET robots, sitemap, pages" --> site
  generator -- "assessments, summary" --> claude
  worker -- "pages, versions, progress, heartbeat" --> tables

  style queue stroke:#2563eb,stroke-width:3px
```

## Pipeline contracts

```mermaid
flowchart LR
  url(["URL"])
  crawler["<b>crawler</b><br/>all network I/O lives here<br/><br/>1 robots.txt, sitemaps, llms.txt<br/>2 seed frontier from homepage nav<br/>3 priority BFS with page budget<br/>4 plain GET; headless per site<br/>5 per-host rate limit, SSRF guard"]
  extractor["<b>extractor</b><br/>pure function, no I/O<br/><br/>1 canonical URL, language<br/>2 title: og, title tag, h1<br/>3 desc: meta, og, first paragraph<br/>4 main content to markdown<br/>5 page type: docs, api, blog, legal…<br/>6 hash of listing fields"]
  generator["<b>generator</b><br/>LLM client, or a stub in dev<br/><br/>1 filter out unlistable pages<br/>2 LLM assesses each page<br/>3 select, score, H2 by page type<br/>4 LLM: site name, summary, notes<br/>5 render, validate against spec"]
  file(["llms.txt"])
  postgres[("<b>Postgres</b><br/>what the monitor diffs against next time")]

  url --> crawler
  crawler -- "RawPage, one at a time" --> extractor
  extractor -- "PageRecord[]: title, desc, type" --> generator
  generator --> file
  crawler -- "etag, last-modified" --> postgres
  extractor -- "record + listing hash" --> postgres
  generator -- "version, if text differs" --> postgres

  style postgres stroke:#2563eb,stroke-width:3px
```

## Crawler

```mermaid
flowchart TD
  inputs(["<b>from the worker</b><br/>the site's root URL<br/>its rendering decision<br/>known pages, each with its ETag, Last-Modified,<br/>sitemap lastmod and stored links"])
  discover["<b>discover URLs</b><br/>robots.txt, sitemaps, the site's own llms.txt, homepage navigation"]
  frontier["<b>frontier: prioritised, breadth first</b><br/>within a depth: navigation, llms.txt, sitemap, other links<br/>a URL family waits after 12 pages; documentation areas take turns;<br/>a translation of a page in the site's language is not fetched"]
  allowed{"<b>may it be requested?</b><br/>robots.txt rules, under the root URL,<br/>500 ms or Crawl-delay apart"}
  skipped(["<b>skipped</b><br/>disallowed by robots.txt, or out of scope"])
  needed{"<b>is a request needed?</b><br/>not for a known page whose trusted<br/>sitemap lastmod has not moved"}
  notRequested(["<b>not requested</b><br/>the stored page stands, and its links still count"])
  fetch["<b>fetch the page</b><br/>plain HTTP, as a conditional GET when validators are stored<br/>headless Chromium if the site needs rendering or the HTML is empty;<br/>a homepage that needs it is confirmed on the next two pages<br/>then a probe for a .md version of the page"]
  guard["<b>SSRF guard</b><br/>every request, the browser's too: each resolved address is checked"]
  site(["<b>target website</b><br/>public addresses only; 15 s and 5 MB per fetch"])
  onPage["<b>onPage(RawPage)</b><br/>handed over as each page arrives, and waited for"]
  workerStore["<b>worker</b><br/>extracts the page and stores it"]
  resources["<b>machine-readable files</b><br/>llms-full.txt, section llms.txt files, OpenAPI: at most 20 requests"]
  result["<b>CrawlResult</b><br/>navigation and inbound-link signals, failed fetches with reasons,<br/>robots.txt status, why the crawl stopped, the rendering decision"]
  workerGate["<b>worker</b><br/>safety gate, then the generator"]

  inputs --> discover
  inputs --> frontier
  discover --> frontier
  frontier -- "next URL" --> allowed
  allowed -- "no" --> skipped
  allowed -- "yes" --> needed
  needed -- "no" --> notRequested
  needed -- "yes" --> fetch
  fetch <--> guard
  guard <--> site
  fetch -- "200, 304, 404 or 410" --> onPage
  onPage --> workerStore
  onPage -- "the page's links join the frontier, until 200 pages, 15 minutes, or no URL is left" --> frontier
  onPage -- "when the pages are done" --> resources
  resources --> result
  result --> workerGate

  style guard stroke:#2563eb,stroke-width:3px
```

## Extractor

```mermaid
flowchart LR
  raw(["<b>RawPage</b><br/>HTML, final URL, response headers"])

  subgraph pure["extractor: a pure function with no I/O, tested on saved HTML fixtures"]
    title["<b>title</b><br/>og:title, then the title tag, then the first h1"]
    description["<b>description</b><br/>meta description, then og:description, then the first paragraph"]
    siteName["<b>declared site name</b><br/>og:site_name, then a JSON-LD WebSite name, then application-name"]
    language["<b>language and canonical URL</b><br/>the html lang attribute and the rel=canonical link"]
    pageType["<b>page type</b><br/>the URL's path or subdomain decides; else og:type and JSON-LD"]
    content["<b>main content, as markdown</b><br/>main, else the only article, else the element with 80% of the prose"]
    digest["<b>content_digest</b><br/>headings and body text, without dates, numbers or whitespace"]
    listingHash["<b>listing_fields_hash</b><br/>title, description and content_digest:<br/>what the monitor counts as a change"]
  end

  record["<b>PageRecord</b><br/>one per page; the worker stores it in the extractor's columns of pages"]

  raw --> title & description & siteName & language & pageType & content
  content --> digest
  title & description & digest --> listingHash
  title & description & siteName & language & pageType & content --> record
  digest & listingHash --> record

  style record stroke:#2563eb,stroke-width:3px
```

## Generator

```mermaid
flowchart TD
  inputs(["<b>from the database</b><br/>pages and their records<br/>page_overrides<br/>excluded_url_prefixes<br/>machine-readable files found"])
  filters["<b>1 deterministic filters</b><br/>homepage, noindex, pagination, other languages, utility and<br/>archive URLs, duplicate content, copies under a locale directory,<br/>large families of sibling pages"]
  notCandidate(["<b>not a candidate</b><br/>never sent to the model"])
  assessment["<b>2 page assessment</b><br/>per page: would an assistant need it? is it broad or narrow?<br/>also a one-line description and a corrected page type"]
  haiku(["<b>Claude Haiku</b><br/>asked once per hash of a page's inputs"])
  selection["<b>3 selection</b><br/>useful pages; a narrow page under a listed broad page is dropped;<br/>three pages stand for a family built from one template;<br/>the user's kept pages and exclusions; one page per canonical URL"]
  userEdit(["<b>a user's edit</b><br/>renders again from the stored pages:<br/>no fetch, no LLM call"])
  leftOut(["<b>left out</b><br/>still stored, so the user can keep it"])
  sections["<b>4 order and sections</b><br/>score: navigation, depth, inbound links, the site's own llms.txt<br/>H2 by page type: Docs, API, Guides … Blog, areas, Pages, Optional"]
  summary["<b>5 site name, summary, notes</b><br/>from the homepage, the listed pages and the text of the few pages<br/>that hold the site's facts (pricing, about), in one request;<br/>the previous wording is passed back and kept unless wrong"]
  opus(["<b>Claude Opus</b><br/>asked once per hash of its inputs"])
  render["<b>6 render</b><br/>H1, blockquote summary, notes, H2 sections of one-line entries"]
  validate{"<b>7 validate against the spec</b><br/>H1 and H2 only, one line per entry,<br/>an H2 named exactly Optional"}
  fails(["<b>run fails</b><br/>the published version stays as it was"])
  publish["<b>8 publish</b><br/>a new version only where the text differs from the newest one"]
  versions[("<b>llms_txt_versions</b><br/>the site serves the newest, or the one pinned")]

  inputs --> filters
  filters --> notCandidate
  filters -- "candidate pages" --> assessment
  assessment <--> haiku
  assessment --> selection
  userEdit --> selection
  selection --> leftOut
  selection -- "listed pages" --> sections
  sections --> summary
  summary <--> opus
  summary --> render
  render --> validate
  validate -- "invalid" --> fails
  validate -- "valid" --> publish
  publish --> versions

  style publish stroke:#2563eb,stroke-width:3px
```

## Monitor

### Scheduling

```mermaid
flowchart TD
  cron(["<b>pg-boss cron</b><br/>every 5 minutes, in the worker"])
  checkNow(["<b>web app: check now</b><br/>at most once per 5 minutes;<br/>joins a run in progress"])
  runsTable[("<b>pipeline_runs</b><br/>a stale run becomes failed; its site is free")]
  sitesTable[("<b>sites</b><br/>next_monitor_check_at<br/>last_monitor_check_at")]

  subgraph tick["monitor tick"]
    reap["<b>1 reap stale runs</b><br/>running with no heartbeat for 2 minutes, or queued for 6 hours"]
    claim["<b>2 claim the sites that are due</b><br/>up to 100; rows another tick has locked are skipped"]
    move["<b>3 move each site's next check on</b><br/>by monitor_check_interval, 7 days unless set otherwise"]
    reap --> claim --> move
  end

  start["<b>startPipelineRun</b><br/>the run row and its job in one transaction; one active run per site"]
  queue["<b>job queue</b><br/>a user's request is taken ahead of a scheduled check; no retries"]
  run["<b>pipeline run, in the worker</b><br/>load, crawl, generate, publish: the same as a first generation"]
  succeeded["<b>succeeded</b><br/>a new version is published"]
  unchanged["<b>unchanged</b><br/>the text is the same, so no new version"]
  failed(["<b>failed</b><br/>the published file stays; the next check retries"])

  cron --> reap
  reap --> runsTable
  sitesTable --> claim
  move --> sitesTable
  move -- "one run per due site" --> start
  checkNow --> start
  start --> queue
  queue --> run
  run --> succeeded & unchanged & failed

  style start stroke:#2563eb,stroke-width:3px
```

### Change detection

```mermaid
flowchart TD
  discover["<b>discover new URLs</b><br/>sitemap diff + homepage links, every check"]
  lastmod{"<b>1 sitemap lastmod</b><br/>only if this site's lastmod has proved reliable<br/>cost per page: no request"}
  conditional{"<b>2 conditional GET</b><br/>needs a stored ETag or Last-Modified<br/>cost per page: 1 small request"}
  hash{"<b>3 fetch, hash listing fields</b><br/>title, description, coarse content digest<br/>cost per page: 1 full request"}
  headless{"<b>4 headless render, then hash</b><br/>pages that only have content after JavaScript<br/>cost per page: 1 browser render"}
  same(["<b>page unchanged</b><br/>stored row is reused as is"])
  gate{"<b>safety gate</b><br/>counts errors, blocks and bot-challenge pages"}
  fails(["<b>run fails</b><br/>published version stays as it was"])
  publish["<b>regenerate and render</b><br/>publish only where the text differs"]

  discover -- "then, for every known page" --> lastmod
  lastmod -- "same lastmod" --> same
  lastmod -- "no trusted lastmod" --> conditional
  conditional -- "304" --> same
  conditional -- "no ETag or Last-Modified" --> hash
  hash -- "same hash" --> same
  hash -- "page needs JavaScript" --> headless
  headless -- "same hash" --> same
  headless -- "pages any method reported changed, plus new ones" --> gate
  gate -- "too many failed fetches" --> fails
  gate -- "failures under threshold" --> publish

  style publish stroke:#2563eb,stroke-width:3px
```

## Data model

```mermaid
erDiagram
  users ||--o{ sites : "owns"
  sites ||--o{ pages : "has many"
  sites ||--o{ pipeline_runs : "has many"
  sites ||--o{ llms_txt_versions : "has many"
  sites ||--o{ excluded_url_prefixes : "ignores"
  sites |o--o| llms_txt_versions : "published_version_id: the version this site serves"
  pipeline_runs ||--o{ pages : "seen in"
  pipeline_runs ||--o{ llms_txt_versions : "publishes"
  pages ||--o| page_overrides : "overrides a page"

  users {
    uuid id PK
    text username UK
    text password_hash
    timestamptz created_at
  }

  sites {
    uuid id PK
    uuid owner_user_id FK
    text root_url "unique per owner"
    text submitted_url "unique per owner"
    text public_slug UK
    text site_title
    text generated_site_name
    text generated_summary
    text[] generated_notes
    text generated_summary_source_hash
    interval monitor_check_interval
    timestamptz next_monitor_check_at
    timestamptz last_monitor_check_at
    boolean sitemap_lastmod_is_trusted
    boolean requires_headless_rendering
    timestamptz headless_rendering_decided_at
    text[] machine_readable_resource_urls
    uuid published_version_id FK
    boolean is_published_version_pinned
    timestamptz created_at
  }

  pages {
    uuid id PK
    uuid site_id FK
    text normalised_url "identity: unique per site"
    text fetch_url "writer: crawler"
    integer http_status_code "writer: crawler"
    text http_etag "writer: crawler"
    text http_last_modified "writer: crawler"
    timestamptz last_fetched_at "writer: crawler"
    text fetch_method "writer: crawler"
    integer crawl_depth "writer: crawler"
    text discovered_via "writer: crawler"
    boolean is_in_site_navigation "writer: crawler"
    integer inbound_link_count "writer: crawler"
    text navigation_label "writer: crawler"
    integer navigation_position "writer: crawler"
    text[] outbound_link_urls "writer: crawler"
    integer first_link_position "writer: crawler"
    timestamptz sitemap_last_modified_at "writer: crawler"
    text markdown_variant_url "writer: crawler"
    boolean has_noindex_directive "writer: crawler"
    text canonical_url "writer: extractor"
    text extracted_title "writer: extractor"
    text extracted_description "writer: extractor"
    text declared_site_name "writer: extractor"
    text page_type "writer: extractor"
    text language_code "writer: extractor"
    text content_markdown "writer: extractor"
    text content_digest "writer: extractor"
    text listing_fields_hash "writer: extractor"
    timestamptz last_extracted_at "writer: extractor"
    text generated_description "writer: generator"
    text assessed_page_type "writer: generator"
    text assessed_page_scope "writer: generator"
    text listing_value "writer: generator"
    text exclusion_reason "writer: generator"
    text assessment_source_hash "writer: generator"
    uuid first_seen_pipeline_run_id FK "lifecycle"
    uuid last_seen_pipeline_run_id FK "lifecycle"
    timestamptz removed_at "lifecycle"
  }

  page_overrides {
    uuid page_id PK, FK
    text description_override
    boolean is_excluded
    boolean is_kept
    timestamptz updated_at
  }

  excluded_url_prefixes {
    uuid site_id PK, FK
    text url_prefix PK
    timestamptz created_at
  }

  pipeline_runs {
    uuid id PK
    uuid site_id FK
    text triggered_by
    text status
    text current_stage
    uuid queue_job_id
    timestamptz last_heartbeat_at
    integer pages_discovered_count
    integer pages_fetched_count
    integer pages_changed_count
    integer pages_failed_count
    text error_message
    timestamptz created_at
    timestamptz started_at
    timestamptz finished_at
  }

  llms_txt_versions {
    uuid id PK
    uuid site_id FK
    uuid pipeline_run_id FK
    integer version_number "unique per site"
    text llms_txt_content
    text llms_txt_content_hash
    integer listed_page_count
    jsonb page_changes
    text created_by
    timestamptz created_at
  }
```
