# Summary

Crawls a site, respecting robots.txt if it exists. Plain HTTP browsing is the default, falling back to a headless browser for client-side rendered sites.

The pages are analysed at the end to detect signals later used for ordering (e.g. inbound link count).

If the server signals a page is unchanged since last crawl (via ETag, sitemap) then the page is skipped.