# Summary

Generates llms.txt files for a crawled & extracted site

There are several phases:
- Discard pages that aren't relevant, based on signals from the extraction phase (e.g. page type)
- Claude Haiku assesses each page to decide each page's inclusion status (primary/optional/exclude), as well as a page type and a short description
- Claude Opus writes the high-level summary for the site, as well as notes if they are required
- The llms.txt is built deterministically from the surviving pages


# Notes

- LLMs are called only when there are functional changes to the relevant parts of the site
- If there were no updates to the llms.txt, it's not re-published
- hack 