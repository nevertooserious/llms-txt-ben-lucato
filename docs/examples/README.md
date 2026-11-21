# Example sites

Generated files for real sites, one per kind of site, as a record of what the tool produces outside its fixtures. They are a dated snapshot, not a test: the sites change, and nothing checks these files in CI.

No results are committed yet. The first run needs the local stack with `ANTHROPIC_API_KEY` set.

## The sites

| Site | Kind |
|---|---|
| https://vitest.dev | Documentation, statically generated |
| https://docs.nestjs.com | Documentation, rendered in the browser |
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

Not run yet.
