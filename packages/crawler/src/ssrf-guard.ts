import { NotImplementedError } from '@llms-txt/contracts';

/**
 * True for private, loopback, link-local and other non-public addresses, including
 * IPv6 and IPv4-mapped forms.
 */
export function isBlockedAddress(ipAddress: string): boolean {
  void ipAddress;
  throw new NotImplementedError('isBlockedAddress');
}

/**
 * Resolves the URL's host and throws if any address is blocked. Returns the address
 * to pin the connection to, so a second DNS answer cannot rebind it.
 */
export async function assertPublicAddress(url: string): Promise<string> {
  void url;
  throw new NotImplementedError('assertPublicAddress');
}
