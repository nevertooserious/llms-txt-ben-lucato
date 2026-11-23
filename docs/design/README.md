# System design

## System overview

![The web app, the worker and Postgres, and how a run moves between them](diagrams/system-overview.svg)

## Pipeline contracts

![The typed hand-offs between the crawler, the extractor and the generator](diagrams/pipeline-contracts.svg)

## Crawler

![How the crawler discovers, orders and fetches a site's pages](diagrams/crawler.svg)

## Extractor

![How the extractor turns one fetched page into a page record](diagrams/extractor.svg)

## Generator

![How the generator turns stored pages into an llms.txt](diagrams/generator.svg)

## Monitor

![How the monitor schedules checks and starts runs](diagrams/monitor.svg)

![How a check finds out which pages changed](diagrams/monitor-check.svg)

## Data model

![The tables and how they relate](diagrams/data-model.svg)
