-- One demo site with four published versions, for demos. docker-compose.yml applies it
-- after db/schema.sql, only when the data volume is empty, and it was applied once to the
-- deployment's empty database. Never apply it to a database that already has sites. It is
-- served at /w/demo.
--
-- The site is on the reserved .example domain and is seeded with no monitor check
-- scheduled, so the worker does not crawl it by itself until "check now" is pressed, which
-- also turns monitoring on. A check on it ends in a failed run, which leaves the published
-- version as it is.

do $seed$
declare
  demo_site_id uuid;
  demo_run_id uuid;
  demo_version_id uuid;
  version_ages interval[] := array[
    interval '21 days', interval '14 days', interval '7 days', interval '1 day'];
  version_page_counts integer[] := array[4, 6, 6, 8];
  version_page_changes jsonb[] := array[
    '{"added": ["https://docs.fernhill.example/quickstart", "https://docs.fernhill.example/install", "https://docs.fernhill.example/api/authentication", "https://docs.fernhill.example/api/projects"], "removed": [], "changed": []}'::jsonb,
    '{"added": ["https://docs.fernhill.example/api/webhooks", "https://docs.fernhill.example/blog/introducing-webhooks"], "removed": [], "changed": ["https://docs.fernhill.example/quickstart"]}'::jsonb,
    '{"added": ["https://docs.fernhill.example/guides/deploy-previews"], "removed": ["https://docs.fernhill.example/install"], "changed": ["https://docs.fernhill.example/api/authentication"]}'::jsonb,
    '{"added": ["https://docs.fernhill.example/api/rate-limits", "https://docs.fernhill.example/changelog"], "removed": [], "changed": ["https://docs.fernhill.example/api/webhooks"]}'::jsonb];
  version_contents text[] := array[
$version$# Fernhill Cloud

> Fernhill Cloud hosts web applications and runs their builds.

## Docs

- [Quickstart](https://docs.fernhill.example/quickstart): Deploy your first application.
- [Install the CLI](https://docs.fernhill.example/install): Install the Fernhill command-line tool.

## API

- [Authentication](https://docs.fernhill.example/api/authentication): Authenticate requests with an API key.
- [Projects](https://docs.fernhill.example/api/projects): Create, list and delete projects.
$version$,
$version$# Fernhill Cloud

> Fernhill Cloud hosts web applications and runs their builds.

## Docs

- [Quickstart](https://docs.fernhill.example/quickstart): Deploy your first application in five minutes.
- [Install the CLI](https://docs.fernhill.example/install): Install the Fernhill command-line tool.

## API

- [Authentication](https://docs.fernhill.example/api/authentication): Authenticate requests with an API key.
- [Projects](https://docs.fernhill.example/api/projects): Create, list and delete projects.
- [Webhooks](https://docs.fernhill.example/api/webhooks): Receive an event when a build finishes.

## Blog

- [Introducing webhooks](https://docs.fernhill.example/blog/introducing-webhooks): Why and how we built build events.
$version$,
$version$# Fernhill Cloud

> Fernhill Cloud hosts web applications and runs their builds.

## Docs

- [Quickstart](https://docs.fernhill.example/quickstart): Deploy your first application in five minutes.
- [Deploy previews](https://docs.fernhill.example/guides/deploy-previews): Get a private URL for every pull request.

## API

- [Authentication](https://docs.fernhill.example/api/authentication): Authenticate requests with an API key or an OAuth token.
- [Projects](https://docs.fernhill.example/api/projects): Create, list and delete projects.
- [Webhooks](https://docs.fernhill.example/api/webhooks): Receive an event when a build finishes.

## Blog

- [Introducing webhooks](https://docs.fernhill.example/blog/introducing-webhooks): Why and how we built build events.
$version$,
$version$# Fernhill Cloud

> Fernhill Cloud hosts web applications and runs their builds.

## Docs

- [Quickstart](https://docs.fernhill.example/quickstart): Deploy your first application in five minutes.
- [Deploy previews](https://docs.fernhill.example/guides/deploy-previews): Get a private URL for every pull request.

## API

- [Authentication](https://docs.fernhill.example/api/authentication): Authenticate requests with an API key or an OAuth token.
- [Projects](https://docs.fernhill.example/api/projects): Create, list and delete projects.
- [Webhooks](https://docs.fernhill.example/api/webhooks): Receive an event when a build starts, finishes or fails.
- [Rate limits](https://docs.fernhill.example/api/rate-limits): Request limits per plan and how to handle them.

## Blog

- [Introducing webhooks](https://docs.fernhill.example/blog/introducing-webhooks): Why and how we built build events.

## Optional

- [Changelog](https://docs.fernhill.example/changelog): Every product change, newest first.
$version$];
begin
  -- The demo belongs to the default login's user. The web app creates that user at
  -- startup; here it gets a password hash that matches nothing, which the app replaces.
  insert into users (username, password_hash)
  values ('user1', 'set by the web app at startup')
  on conflict (username) do nothing;

  insert into sites (
    owner_user_id, root_url, submitted_url, public_slug, site_title, generated_summary,
    last_monitor_check_at, created_at)
  values (
    (select id from users where username = 'user1'),
    'https://docs.fernhill.example',
    'https://docs.fernhill.example',
    'demo',
    'Fernhill Cloud',
    'Fernhill Cloud hosts web applications and runs their builds.',
    now() - version_ages[4],
    now() - version_ages[1])
  returning id into demo_site_id;

  for version_index in 1 .. array_length(version_contents, 1) loop
    insert into pipeline_runs (
      site_id, triggered_by, status,
      pages_discovered_count, pages_fetched_count, pages_changed_count,
      created_at, started_at, finished_at)
    values (
      demo_site_id,
      case when version_index = 1 then 'submission' else 'monitor' end,
      'succeeded',
      version_page_counts[version_index],
      version_page_counts[version_index],
      jsonb_array_length(version_page_changes[version_index] -> 'added')
        + jsonb_array_length(version_page_changes[version_index] -> 'changed'),
      now() - version_ages[version_index],
      now() - version_ages[version_index],
      now() - version_ages[version_index] + interval '40 seconds')
    returning id into demo_run_id;

    insert into llms_txt_versions (
      site_id, pipeline_run_id, version_number, llms_txt_content, llms_txt_content_hash,
      listed_page_count, page_changes, created_by, created_at)
    values (
      demo_site_id,
      demo_run_id,
      version_index,
      version_contents[version_index],
      encode(sha256(convert_to(version_contents[version_index], 'UTF8')), 'hex'),
      version_page_counts[version_index],
      version_page_changes[version_index],
      'pipeline',
      now() - version_ages[version_index] + interval '40 seconds')
    returning id into demo_version_id;
  end loop;

  update sites set published_version_id = demo_version_id where id = demo_site_id;
end
$seed$;
