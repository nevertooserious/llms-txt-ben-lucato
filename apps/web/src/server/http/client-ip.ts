/**
 * The client's IP for rate limiting, from X-Forwarded-For. Each proxy appends the address
 * it saw, so entries on the left are whatever the client sent and only the last
 * `trustedProxyHops` entries can be believed. The client is the entry the outermost
 * trusted proxy appended. Null when the header is absent.
 */
// TODO blucato explore how rate-limiting works
export function clientIpFrom(headers: Headers, trustedProxyHops = 1): string | null {
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) return null;
  return entries[Math.max(0, entries.length - trustedProxyHops)]!;
}
