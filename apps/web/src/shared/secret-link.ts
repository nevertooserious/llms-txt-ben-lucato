/**
 * The path of a workspace's secret link. The token travels in the URL fragment
 * (/w/{slug}#token=...), which browsers never send to the server, so it stays out of
 * request logs.
 */
export function secretLinkPath(publicSlug: string, accessToken: string): string {
  return `/w/${encodeURIComponent(publicSlug)}#token=${encodeURIComponent(accessToken)}`;
}
