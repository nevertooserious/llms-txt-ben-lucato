// The typed hand-offs between pipeline stages (docs/design/README.md, "Pipeline contracts"):
//
//   crawler:   site URL       -> RawPage, one at a time, then a CrawlResult
//   extractor: RawPage        -> PageRecord
//   generator: GeneratorPage[] -> llms.txt text
//
// Enum values mirror the check constraints in db/schema.sql; a test in @llms-txt/db
// keeps the two in step.

export * from './crawl';
export * from './generation';
export * from './machine-readable-resources';
export * from './page-assessment';
export * from './page-record';
export * from './pipeline-jobs';
