# The hub eval

Does the llms.txt this app writes for a site hold the useful content of the llms.txt the site publishes itself? The sites come from the directory at <https://llmstxthub.com>. The files are not compared word for word: a judge model lists what each site's own file holds that an assistant would need, and then checks whether ours gives an assistant the same things.

`scripts/eval-hub.mjs` runs it. Nothing runs it in CI: it crawls live sites and calls a model.

## What is measured

For each site:

- **Coverage.** `key-items/<host>.json` lists up to 15 things from the site's own file: pages, families of similar pages, machine-readable resources, and facts stated in its prose. The judge marks each as covered (1), partly covered (0.5) or missing (0) in our file. A page or resource whose URL our file links is covered without asking the judge. Coverage is the mean. An item that is only the site's homepage is left out, since every llms.txt is about its site.
- **Junk rate.** The share of our entries the judge says add nothing: all but three of a family of near-identical pages, a duplicate, a page that is not content, or an entry whose text does not say what the page holds. The judge does not see the site's own file for this.
- **Pass.** Coverage of at least 0.70 and a junk rate of at most 0.15.

The site's own file is evidence of what matters on the site, not the answer. Some are poor: a bare list of URLs, an index of index files, a heading per page. The key items are what a judge took from the file as worth having, and the junk rate is judged without it.

## Rules that keep the score honest

- **The crawl does not read the site's own llms.txt.** The worker runs with `IGNORE_EXISTING_LLMS_TXT=true`. Otherwise the crawler seeds itself from that file, and the eval would measure how well it is copied. The app is for sites that have no llms.txt.
- **Ten sites are held out** (`"split": "test"` in `sites.json`). Changes are chosen by reading what the other sites miss; the held-out sites' files and judgements are not read, only their scores. The held-out score is the result.
- **A fix names no site.** A rule that only one site needs is not a fix.
- **A site that turns every crawler away is not scored** (`"blocksCrawlers": true`).

## Running it

Start the stack with the worker ignoring existing files, and submit the sites (`sites.json`) through the app or `POST /api/sites`.

```sh
node --env-file=.env scripts/eval-hub.mjs references        # each site's own llms.txt, into runs/references/
node --env-file=.env scripts/eval-hub.mjs key-items         # only for a site with no key-items file yet
node scripts/eval-hub.mjs collect baseline                  # our published files, into runs/baseline/outputs/
node --env-file=.env scripts/eval-hub.mjs score baseline 2  # two judge passes; prints the table below
```

To score a change to the generator against the same crawl, render the files again from the stored pages. No site is fetched; pages whose assessment inputs changed are assessed again.

```sh
node scripts/eval-hub.mjs regenerate my-change
node --env-file=.env scripts/eval-hub.mjs score my-change 2
```

A change to the crawler needs the sites crawled again. `runs/` is not committed. Each variant holds `outputs/<host>.txt` and `results.jsonl`, one row per site and judge pass with the grade, the items missed and the entries called junk.

The key items are committed so that scores stay comparable. Delete a site's file to have it made again from the current reference.

## Noise

Scored twice, the same files differ by about 0.02 in a site's coverage on average, and now and then by 0.1 or more where an item describes a whole area of a site. The mean over the sites moves by less than 0.01 between passes. A crawl of the same site on another day gives another 200 pages of a large site, so compare a crawler change on fresh crawls of both versions, and read a difference of 0.02 in a mean as none.

## Results

Thirty-three sites: 23 used to choose changes, of which one blocks crawlers and is not scored, and 10 held out. Every number is the mean of two judge passes. November 2026, page budget 200.

| Variant | Coverage, tuning | Coverage, held out | Junk, tuning | Junk, held out | Pass, tuning | Pass, held out |
|---|---|---|---|---|---|---|
| Baseline (`main`) | 0.53 | 0.55 | 0.10 | 0.11 | 18% | 0% |
| 1 Crawler: translations, rendering decision, gzip in the browser | 0.61 | 0.54 | 0.09 | 0.12 | 30% | 0% |
| 2 Notes state the site's facts | 0.65 | 0.59 | 0.08 | 0.12 | 32% | 10% |
| 3 What a site offers and its content indexes count as useful | 0.71 | 0.65 | 0.15 | 0.18 | 34% | 20% |
| 4 Three pages stand for a family with one title template | 0.70 | 0.63 | 0.11 | 0.15 | 41% | 30% |
| 5 The same for narrow pages of one directory | 0.70 | 0.63 | 0.08 | 0.13 | 48% | 30% |
| 6 The same for addresses that differ in one place | 0.70 | 0.64 | 0.07 | 0.11 | 43% | 30% |
| 7 All of it on a fresh crawl, with locale copies and named OpenAPI files | 0.71 | 0.64 | 0.07 | 0.12 | 39% | 40% |

Variants 2 to 6 were scored on the crawl of variant 1. Variant 7 crawled every site again.

The held-out sites went from 0.55 to 0.64 in coverage, by 0.09 with a 95% interval of about 0.08 either way over the ten sites, and from none passing to four. The target of 24 sites in 30 passing was not met: 12 or 13 of the 32 pass. Five more are within 0.05 of the coverage bar.

What the held-out sites did not gain from: the crawler fixes of variant 1, which help only a site that has that fault. One held-out documentation site lost 0.10 when template families were first cut to three pages (variant 4) and did not recover.

What is still missed on the tuning sites, as a share of all key items: facts stated in the site's own file (0.10), single pages (0.08), families (0.06) and machine-readable resources such as MCP servers, which the site's pages rarely link (0.05). No one cause is large. A documentation site of over a thousand pages is covered only in part within the page budget.
