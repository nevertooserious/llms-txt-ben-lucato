-- llms.txt generator: data model (Postgres 14+)
--
-- Six tables:
--   sites                     one row per crawled website; shared crawl and monitor state
--   site_workspaces           one row per submission of a site; many per site. Holds the
--                             access token, the user's overrides and the published version
--   pages                     current state of each known URL of a site; mutable
--   workspace_page_overrides  a workspace's edits to individual pages
--   pipeline_runs             one row per execution of crawl -> extract -> generate for a site;
--                             the audit log and the source of progress shown in the UI
--   llms_txt_versions         every published llms.txt of a workspace; append-only
--
-- Crawl results (sites, pages) are shared by every workspace on the same site, so a
-- second person submitting the same site reuses them. What differs per workspace is
-- only the overrides and therefore the rendered file.
--
-- The job queue is owned by pg-boss in its own schema and is not declared here.
-- pipeline_runs records what a job did; pg-boss decides when and where it runs.

begin;

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
create table sites (
  id                               uuid primary key default gen_random_uuid(),

  -- Crawl scope: scheme + host + optional path prefix, lowercase host, no trailing
  -- slash. "https://example.com" or "https://example.com/docs". Taken after following
  -- the homepage redirect, so "example.com" and "www.example.com" land on one row.
  root_url                         text not null unique,

  -- Extractor: the site's name, from the homepage.
  site_title                       text,

  -- Generator: the blockquote summary at the top of llms.txt. Cached, because an LLM
  -- words it differently every time it is asked; regenerated only when the inputs change.
  generated_summary                text,
  -- SHA-256 of what should change the summary: the model, prompt version, site title,
  -- the homepage's title and description, and the listed navigation pages' titles.
  -- Narrow on purpose, so routine new content does not reword the summary.
  generated_summary_source_hash    text,

  -- Monitor state. A fixed interval; users can also trigger a check by hand.
  monitor_check_interval           interval not null default interval '7 days',
  -- Null means no check is scheduled. Set only while at least one workspace on this
  -- site has unexpired monitoring.
  next_monitor_check_at            timestamptz,
  last_monitor_check_at            timestamptz,
  -- Whether sitemap <lastmod> can be used as a change signal for this site. False
  -- until lastmod is present and has been seen to agree with real content changes;
  -- set back to false if a page's content changed while its lastmod did not.
  sitemap_lastmod_is_trusted       boolean not null default false,
  -- Fingerprints from discovery, e.g. {"sitemaps": {"<url>": {"etag": "...", "hash": "..."}}, "nav_hash": "..."}.
  discovery_fingerprints           jsonb not null default '{}'::jsonb,
  -- Crawler: whether the site only has content after JavaScript runs, so every page is
  -- fetched with the headless browser. Null until a crawl decides it by fetching the
  -- homepage both ways; the worker passes null again once the decision is 30 days old,
  -- so a site that moves to server rendering is noticed.
  requires_headless_rendering      boolean,
  headless_rendering_decided_at    timestamptz,

  created_at                       timestamptz not null default now(),

  constraint sites_monitor_check_interval_bounds
    check (monitor_check_interval between interval '1 hour' and interval '30 days'),
  constraint sites_headless_rendering_decided_together
    check ((requires_headless_rendering is null) = (headless_rendering_decided_at is null))
);

-- The monitor's due-site scan.
create index sites_due_for_monitor_check_idx
  on sites (next_monitor_check_at) where next_monitor_check_at is not null;

-- ---------------------------------------------------------------------------
-- site_workspaces
-- ---------------------------------------------------------------------------
-- There are no user accounts. Each submission of a URL creates a workspace and hands
-- the submitter a secret link. Many workspaces can exist for one site, and none of
-- them can see or change another's overrides.
create table site_workspaces (
  id                        uuid primary key default gen_random_uuid(),
  site_id                   uuid not null references sites (id) on delete cascade,

  -- SHA-256 of the random token in the secret link. Holding the link authorises
  -- editing this workspace. The token itself is never stored.
  access_token_hash         text not null unique,
  -- Public, read-only identifier in the hosted URL: /w/{public_slug}/llms.txt.
  public_slug               text not null unique,

  -- Monitoring is opt-in and expires, so abandoned submissions stop being re-crawled.
  -- Null means monitoring is off.
  monitoring_enabled_until  timestamptz,

  -- The version served at the hosted URL. Null until the first run succeeds.
  -- Foreign key is added below, after llms_txt_versions exists.
  published_version_id      uuid,

  -- SHA-256 of the submitter's IP, for per-IP submission rate limiting.
  creator_ip_hash           text,
  created_at                timestamptz not null default now()
);

create index site_workspaces_site_idx on site_workspaces (site_id);
create index site_workspaces_rate_limit_idx on site_workspaces (creator_ip_hash, created_at);

-- ---------------------------------------------------------------------------
-- pipeline_runs
-- ---------------------------------------------------------------------------
create table pipeline_runs (
  id                         uuid primary key default gen_random_uuid(),
  site_id                    uuid not null references sites (id) on delete cascade,
  -- The workspace whose user started the run. Null for monitor runs.
  requested_by_workspace_id  uuid references site_workspaces (id) on delete set null,

  -- What started this run: a URL submission, the monitor's schedule, or a user
  -- pressing "check now".
  triggered_by               text not null
                             check (triggered_by in ('submission', 'monitor', 'user_check_now')),
  -- 'unchanged' is a successful check that found nothing to publish.
  status                     text not null default 'queued'
                             check (status in ('queued', 'running', 'succeeded', 'unchanged', 'failed')),
  current_stage              text check (current_stage in ('crawl', 'extract', 'generate')),

  -- Link to the pg-boss job carrying this run.
  queue_job_id               uuid,
  -- Updated every few seconds while the worker is alive. A 'running' row whose
  -- heartbeat has gone stale is marked 'failed' by the reaper, which frees the
  -- one-active-run-per-site slot below.
  last_heartbeat_at          timestamptz,

  -- Progress counters, updated as the run proceeds and polled by the frontend.
  pages_discovered_count     integer not null default 0,
  pages_fetched_count        integer not null default 0,
  pages_changed_count        integer not null default 0,
  -- Fetches that errored, were blocked, or returned a bot-challenge page. If this is
  -- too large a share of the run, the run fails and nothing is published.
  pages_failed_count         integer not null default 0,

  error_message              text,
  created_at                 timestamptz not null default now(),
  started_at                 timestamptz,
  finished_at                timestamptz
);

create index pipeline_runs_site_recent_idx on pipeline_runs (site_id, created_at desc);
create index pipeline_runs_stale_heartbeat_idx
  on pipeline_runs (last_heartbeat_at) where status = 'running';
-- The reaper's other scan: runs queued so long that their job will never claim them.
create index pipeline_runs_stale_queued_idx
  on pipeline_runs (created_at) where status = 'queued';

-- At most one queued or running run per site, so two crawls never race on the same pages.
create unique index pipeline_runs_one_active_per_site_idx
  on pipeline_runs (site_id) where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- pages
-- ---------------------------------------------------------------------------
-- Column groups are owned by one writer each. A stage only writes its own group.
create table pages (
  id                                   uuid primary key default gen_random_uuid(),
  site_id                              uuid not null references sites (id) on delete cascade,
  -- The row's identity: the URL after cleanup that needs no fetch (lowercase host,
  -- fragment and tracking params removed, query sorted, trailing slash and default port
  -- stripped). The crawler requests the URL as the site linked it, and keys on this.
  normalised_url                       text not null,

  -- Crawler: fetch fingerprint and discovery signals.
  -- The URL as the site last linked it, which is what a re-check requests. The crawler
  -- never requests a form the site did not link, and normalised_url may not be one.
  fetch_url                            text not null,
  http_status_code                     integer,
  http_etag                            text,
  http_last_modified                   text,   -- stored verbatim for If-Modified-Since
  last_fetched_at                      timestamptz,
  fetch_method                         text check (fetch_method in ('plain_http', 'headless_browser')),
  -- Link hops from the root URL.
  crawl_depth                          integer,
  discovered_via                       text check (discovered_via in
                                         ('sitemap', 'navigation', 'page_link', 'existing_llms_txt')),
  is_in_site_navigation                boolean not null default false,
  inbound_link_count                   integer not null default 0,
  sitemap_last_modified_at             timestamptz,
  -- Consecutive direct fetches that returned 404 or 410. removed_at is set at 2.
  -- Not being reached by a crawl does not count; only the page's own response does.
  consecutive_not_found_count          integer not null default 0,
  -- URL of a markdown version of the page (same URL + ".md"), if one exists. The
  -- spec recommends linking these in preference to the HTML page.
  markdown_variant_url                 text,
  -- A robots directive for this crawler (<meta name="robots"> or X-Robots-Tag) says
  -- noindex. The site asks that the page not be listed, so the generator leaves it out.
  has_noindex_directive                boolean not null default false,

  -- Extractor: the PageRecord.
  -- What the page declares in <link rel="canonical">, if anything. Used to drop
  -- duplicates when selecting pages; several rows may share one value.
  canonical_url                        text,
  extracted_title                      text,
  extracted_description                text,
  page_type                            text check (page_type in
                                         ('home', 'docs', 'api', 'guide', 'blog', 'product', 'pricing',
                                          'about', 'legal', 'other')),
  language_code                        text,
  content_markdown                     text,
  -- SHA-256 of a coarse view of the main content: headings and body text with dates,
  -- numbers and whitespace stripped. Coarse on purpose, so "updated 3 days ago" does
  -- not count as a change.
  content_digest                       text,
  -- The monitor's change signal: SHA-256 of what feeds this page's llms.txt entry.
  -- That is extracted_title + extracted_description + content_digest, because the
  -- entry's description is written from the page's content.
  listing_fields_hash                  text,
  last_extracted_at                    timestamptz,

  -- Generator: the LLM's cached assessment of the page. Written together, and asked
  -- for again only when assessment_source_hash no longer matches the page's inputs.
  importance_score                     real,
  generated_description                text,
  -- Corrects page_type, which the extractor guesses from the URL. Never 'home'.
  assessed_page_type                   text check (assessed_page_type in
                                         ('docs', 'api', 'guide', 'blog', 'product', 'pricing',
                                          'about', 'legal', 'other')),
  listing_value                        text check (listing_value in ('primary', 'optional', 'exclude')),
  -- Set exactly when listing_value is 'exclude'.
  exclusion_reason                     text check (exclusion_reason in
                                         ('error_page', 'utility', 'thin', 'archive',
                                          'individual_content', 'duplicate')),
  -- SHA-256 of the model, prompt version and page inputs the assessment was made from.
  assessment_source_hash               text,

  -- Lifecycle.
  first_seen_pipeline_run_id           uuid references pipeline_runs (id) on delete set null,
  last_seen_pipeline_run_id            uuid references pipeline_runs (id) on delete set null,
  -- Set after two consecutive 404/410 responses. Rows are kept so workspace
  -- overrides survive a page that comes back.
  removed_at                           timestamptz,

  constraint pages_site_normalised_url_key unique (site_id, normalised_url),
  constraint pages_assessment_written_together check (
    (assessment_source_hash is null) = (generated_description is null)
    and (assessment_source_hash is null) = (assessed_page_type is null)
    and (assessment_source_hash is null) = (listing_value is null)
  ),
  constraint pages_exclusion_reason_matches_listing_value check (
    (exclusion_reason is not null) = (listing_value is not distinct from 'exclude')
  )
);

-- The generator's read: live pages for a site.
create index pages_not_removed_idx on pages (site_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- workspace_page_overrides
-- ---------------------------------------------------------------------------
-- Edits are stored as inputs to the generator, not as edits to its output, so they
-- survive regeneration. The section a page appears under is derived from page_type
-- and is not editable.
create table workspace_page_overrides (
  workspace_id          uuid not null references site_workspaces (id) on delete cascade,
  page_id               uuid not null references pages (id) on delete cascade,

  description_override  text,
  is_excluded           boolean not null default false,
  updated_at            timestamptz not null default now(),

  primary key (workspace_id, page_id)
);

-- ---------------------------------------------------------------------------
-- llms_txt_versions
-- ---------------------------------------------------------------------------
create table llms_txt_versions (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references site_workspaces (id) on delete cascade,
  -- Null for versions created by a user edit rather than a pipeline run.
  pipeline_run_id        uuid references pipeline_runs (id) on delete set null,
  -- Allocated while holding a row lock on the workspace, so a user edit and a
  -- pipeline run cannot both take the same number.
  version_number         integer not null,

  llms_txt_content       text not null,
  -- SHA-256 of llms_txt_content; an equal hash means no new version is written.
  llms_txt_content_hash  text not null,
  listed_page_count      integer not null,
  -- {"added": [url], "removed": [url], "changed": [url]} relative to the previous version.
  page_changes           jsonb not null default '{}'::jsonb,
  created_by             text not null check (created_by in ('pipeline', 'user_edit')),
  created_at             timestamptz not null default now(),

  constraint llms_txt_versions_workspace_version_number_key unique (workspace_id, version_number)
);

alter table site_workspaces
  add constraint site_workspaces_published_version_fk
  foreign key (published_version_id) references llms_txt_versions (id) on delete set null;

commit;
