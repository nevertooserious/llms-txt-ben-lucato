/**
 * How long monitoring lasts from a submission or a "check now". It expires so that
 * abandoned workspaces stop being re-crawled (docs/design/README.md, section 7).
 */
export const MONITORING_DURATION_SECONDS = 30 * 24 * 3600;
