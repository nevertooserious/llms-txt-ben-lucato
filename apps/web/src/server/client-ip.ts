/**
 * The client's IP for rate limiting: the first X-Forwarded-For entry, which the hosting
 * platform's proxy sets. Only trustworthy behind such a proxy; null when absent.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || headers.get('x-real-ip')?.trim() || null;
}
