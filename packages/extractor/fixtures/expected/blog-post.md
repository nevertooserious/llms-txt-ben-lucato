# How we cut build times in half

By Dana Whitfield · 3 March 2026

Updated 2 days ago · 1,204 views

Large sites were taking minutes to build because every page re-parsed the same templates. Caching parsed templates between pages removed most of that work.

## Where the time went

Profiling showed that template parsing, not rendering, dominated the build. A site with 4,000 pages parsed its layout 4,000 times.

## What we changed

Templates are now parsed once per build and shared by every page that uses them.
