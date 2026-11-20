import type { NetworkPolicy } from '@llms-txt/crawler';

/**
 * A network policy for tests: loopback connections to the given ports only.
 *
 * The fixture sites listen on loopback, which the production policy refuses. This
 * policy is as narrow as possible so the SSRF cases still mean something: a redirect to
 * the metadata address, a private range, or a loopback port that is not a fixture site
 * is still refused. It lives in the tests, not the crawler, so production code has no
 * way to loosen the guard.
 */
export function allowLoopbackPorts(ports: Iterable<number>): NetworkPolicy {
  const allowedPorts = new Set(ports);
  return {
    isAllowedConnection: (ipAddress, port) =>
      (ipAddress === '127.0.0.1' || ipAddress === '::1') && allowedPorts.has(port),
  };
}
