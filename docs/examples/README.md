# Example sites

Generated files for real sites, one per kind of site, as a record of what the tool produces outside its fixtures. They are a dated snapshot, not a test: the sites change, and nothing checks these files in CI.

## The sites

| Site | Kind |
|---|---|
| https://vitest.dev | Documentation, statically generated |
| https://docs.nestjs.com | Documentation, an Angular app served prerendered |
| https://rxjs.dev | Documentation, rendered in the browser |
| https://bun.sh | Product site with its own llms.txt |
| https://tailscale.com | Marketing site |
| https://overreacted.io | Blog |
| https://www.deathwishcoffee.com | Shop |
| https://www.ruby-lang.org/ja | Not in English, under a path |
| https://danluu.com | Plain HTML with no navigation |
| https://www.python.org | Large site with many sections |

The list is `EXAMPLE_SITES` in [`scripts/generate-examples.mjs`](../../scripts/generate-examples.mjs).

## Regenerating

```sh
docker compose up --build                # with ANTHROPIC_API_KEY in .env
node scripts/generate-examples.mjs       # every site, about 10 minutes
node scripts/generate-examples.mjs https://vitest.dev   # only these
```

The script submits each site through the REST API, waits for its run, and saves each published file here as `<host>.txt`. It prints a results table (file or failure reason, pages fetched, fetches failed, entries, seconds). Paste that table below with the date, and add a line per site on what the file gets right and wrong.

It reads `BASE_URL` (default `http://localhost:3000`), `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD`. Every site is a new submission, so one full run uses all ten of an IP's submissions for the hour.

## Results

Run on 21 November 2026 with Claude assessing pages and writing summaries, and a page budget of 200. Only rxjs.dev needed the headless browser.

| Site | File | Pages fetched | Fetches failed | Entries | Seconds |
|---|---|---|---|---|---|
| https://vitest.dev | [vitest.dev.txt](vitest.dev.txt) | 200 | 0 | 38 | 172 |
| https://docs.nestjs.com | [docs.nestjs.com.txt](docs.nestjs.com.txt) | 183 | 0 | 38 | 263 |
| https://rxjs.dev | [rxjs.dev.txt](rxjs.dev.txt) | 200 | 0 | 29 | 473 |
| https://bun.sh | [bun.sh.txt](bun.sh.txt) | 200 | 0 | 56 | 272 |
| https://tailscale.com | [tailscale.com.txt](tailscale.com.txt) | 200 | 0 | 31 | 172 |
| https://overreacted.io | [overreacted.io.txt](overreacted.io.txt) | 59 | 2 | 18 | 57 |
| https://www.deathwishcoffee.com | [www.deathwishcoffee.com.txt](www.deathwishcoffee.com.txt) | 200 | 72 | 33 | 221 |
| https://www.ruby-lang.org/ja | [www.ruby-lang.org-ja.txt](www.ruby-lang.org-ja.txt) | 200 | 0 | 9 | 175 |
| https://danluu.com | [danluu.com.txt](danluu.com.txt) | 171 | 0 | 25 | 331 |
| https://www.python.org | [www.python.org.txt](www.python.org.txt) | 200 | 0 | 42 | 149 |

What each file gets right and wrong:

- **vitest.dev:** guides, API pages and the config index, without the hundred pages for single config options. An older version's site (`v4.vitest.dev`) is listed under About.
- **docs.nestjs.com:** the pages and their order follow the sidebar, and entries link the `.md` variants.
- **rxjs.dev:** every page was rendered in the browser. Guides and the main classes are listed, and single operators are left to the API index. The crawl takes eight minutes.
- **bun.sh:** sections match the site, entries link `.md` variants, and the site's `llms-full.txt` is listed. `Optional` holds one-line utility guides that add little.
- **tailscale.com:** product, pricing, about and docs are separated well, and the docs section's own `llms.txt` is listed. Some titles are marketing headlines.
- **overreacted.io:** the summary is right, and a blog's file is rightly a sample of its posts.
- **www.deathwishcoffee.com:** collections, help, about and brewing guides are listed with a few products. A third of the fetches failed, for a reason not yet looked into.
- **www.ruby-lang.org/ja:** the site's main areas, with Japanese titles and English descriptions. Only nine entries.
- **danluu.com:** the summary is right. With no sections on the site, the file is a sample of essays, mostly under `Optional`.
- **www.python.org:** sections and descriptions are good, across python.org and the hosts its navigation links.

## What the first runs found

These files come after fixes that earlier runs of the same sites led to:

- A page the sitemap listed first lost its place as a navigation page, so on ruby-lang.org/ja the whole budget went to old news posts and nothing could be listed.
- A link to `/post/index.md` in a site's own llms.txt was mapped to `/post/index` (overreacted.io).
- A site that declares its whole homepage title as `og:site_name` got that as its H1, and its entries kept the site name (docs.nestjs.com).
- Pages for single config options and single operators filled the Docs and API sections (vitest.dev, rxjs.dev).
- Titles built from a heading carried its anchor icon's text, as in `Subscriptionlink` (rxjs.dev).
- Descriptions were in the page's language under an English summary (ruby-lang.org/ja); all are now in English.
- A copy of the homepage at another address was listed, and donation and membership pages were filed under Product and Pricing (python.org).
