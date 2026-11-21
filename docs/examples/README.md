# Example sites

Generated files for real sites, one per kind of site, as a record of what the tool produces outside its fixtures. They are a dated snapshot, not a test: the sites change, and nothing checks these files in CI.

## The sites

| Site | Kind |
|---|---|
| https://vitest.dev | Documentation, statically generated |
| https://docs.nestjs.com | Documentation, an Angular app served prerendered |
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
node scripts/generate-examples.mjs       # every site, about 15 minutes at most
node scripts/generate-examples.mjs https://vitest.dev   # only these
```

The script submits each site through the REST API, waits for its run, and saves each published file here as `<host>.txt`. It prints a results table (file or failure reason, pages fetched, fetches failed, entries, seconds). Paste that table below with the date, and add a line per site on what the file gets right and wrong.

It reads `BASE_URL` (default `http://localhost:3000`), `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD`. Every site is a new submission, so one full run uses nine of an IP's ten submissions an hour.

## Results

Run on 21 November 2026 with Claude assessing pages and writing summaries, a page budget of 200, and no site needing the headless browser. The first run found two crawler bugs, described below; those two sites were run again after the fixes.

| Site | File | Pages fetched | Fetches failed | Entries | Seconds |
|---|---|---|---|---|---|
| https://vitest.dev | [vitest.dev.txt](vitest.dev.txt) | 200 | 0 | 52 | 174 |
| https://docs.nestjs.com | [docs.nestjs.com.txt](docs.nestjs.com.txt) | 183 | 0 | 36 | 265 |
| https://bun.sh | [bun.sh.txt](bun.sh.txt) | 200 | 0 | 56 | 276 |
| https://tailscale.com | [tailscale.com.txt](tailscale.com.txt) | 200 | 0 | 33 | 325 |
| https://overreacted.io | [overreacted.io.txt](overreacted.io.txt) | 59 | 2 | 17 | 56 |
| https://www.deathwishcoffee.com | [www.deathwishcoffee.com.txt](www.deathwishcoffee.com.txt) | 200 | 67 | 13 | 218 |
| https://www.ruby-lang.org/ja | [www.ruby-lang.org-ja.txt](www.ruby-lang.org-ja.txt) | 200 | 0 | 9 | 164 |
| https://danluu.com | [danluu.com.txt](danluu.com.txt) | 171 | 0 | 20 | 373 |
| https://www.python.org | [www.python.org.txt](www.python.org.txt) | 200 | 0 | 45 | 152 |

What each file gets right and wrong:

- **vitest.dev:** the name, summary and Guides section are right. Docs and API are filled with single config options (`deps`, `runner`, `root`), which crowd out the pages that explain the tool.
- **docs.nestjs.com:** the pages and their order follow the sidebar, and entries link the `.md` variants. The H1 is the whole homepage title, and every entry title keeps its ` | NestJS` suffix.
- **bun.sh:** the best of the set: sections match the site, entries link `.md` variants, and the site's `llms-full.txt` is listed. `Optional` holds one-line utility guides that add little.
- **tailscale.com:** product, pricing, about and docs are separated well, and the docs section's own `llms.txt` is listed. Some titles are marketing headlines.
- **overreacted.io:** the summary is right, and a blog's file is rightly a sample of its posts. The first run linked every post at `/index`, mapped wrongly from the `index.md` links in the site's own llms.txt; fixed.
- **www.deathwishcoffee.com:** a third of the fetches failed, and the file is a handful of single products with no collections, shipping or about pages.
- **www.ruby-lang.org/ja:** the first run failed with nothing to list: pages the sitemap had already listed lost their place as navigation pages, so the whole budget went to old news posts. Fixed, and the file now lists the site's main areas. The summary is in Japanese but most descriptions are in English.
- **danluu.com:** the summary is right. With no sections on the site, the file is a sample of essays, mostly under `Optional`.
- **www.python.org:** sections and descriptions are good. `/shell/` is listed although it serves the homepage, and a membership page and a fundraiser are filed under Pricing and Product.
