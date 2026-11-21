import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { buildConnector } from 'undici';

// Every outbound connection the crawler makes is checked here, at connect time, against
// the exact address the socket is about to use. Checking at connect time is what pins
// the address: there is no second DNS lookup between the check and the connection, so a
// rebinding answer cannot slip a private address in. Redirects open new connections and
// are checked the same way.

/** Decides whether the crawler may open a connection to an address and port. */
export interface NetworkPolicy {
  isAllowedConnection(ipAddress: string, port: number): boolean;
}

/** Thrown when a URL or connection is refused by the network policy. */
export class BlockedAddressError extends Error {
  constructor(
    readonly hostname: string,
    readonly ipAddress: string,
  ) {
    super(`refused connection to ${hostname} (${ipAddress}): not a public address`);
    this.name = 'BlockedAddressError';
  }
}

// IANA special-purpose registries, plus multicast and reserved space. Hosting platform
// private networks fall inside these: Fly uses fdaa::/16 and Railway fd12::/16 (both in
// fc00::/7), and both use 100.64.0.0/10 or RFC 1918 space for IPv4.
const BLOCKED_IPV4_SUBNETS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT, also used by platform private networks
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
];

const BLOCKED_IPV6_SUBNETS: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated)
  ['64:ff9b:1::', 48], // local-use NAT64: translates to an IPv4 address inside the network
  ['100::', 64], // discard
  ['2001::', 32], // Teredo: tunnels to an arbitrary IPv4 address
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local, including platform private networks
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

const blockList = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4_SUBNETS) blockList.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of BLOCKED_IPV6_SUBNETS) blockList.addSubnet(network, prefix, 'ipv6');

/**
 * True for private, loopback, link-local and other non-public addresses, including
 * IPv6 and IPv4-mapped forms. Anything that is not a valid IP address is blocked.
 */
export function isBlockedAddress(ipAddress: string): boolean {
  const address = stripBrackets(ipAddress);
  const family = isIP(address);
  if (family === 4) return blockList.check(address, 'ipv4');
  if (family !== 6) return true;

  // IPv6 forms that carry an IPv4 address are judged by that address.
  const embeddedIpv4 = embeddedIpv4Address(address);
  if (embeddedIpv4 !== null) return blockList.check(embeddedIpv4, 'ipv4');
  return blockList.check(address, 'ipv6');
}

/** The production policy: public addresses on any port. */
export const publicInternetOnly: NetworkPolicy = {
  isAllowedConnection: (ipAddress) => !isBlockedAddress(ipAddress),
};

/** Resolves a hostname to every address it has. Injectable so tests can simulate DNS. */
export type HostnameResolver = (hostname: string) => Promise<string[]>;

export const resolveWithSystemDns: HostnameResolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

/**
 * Resolves the URL's host and throws `BlockedAddressError` if any of its addresses is
 * refused. Returns the address to connect to.
 *
 * Refusing when any address is blocked, rather than picking an allowed one, stops a host
 * from listing a public and a private address and relying on the client to try both.
 */
export async function assertPublicAddress(
  url: string,
  networkPolicy: NetworkPolicy = publicInternetOnly,
  resolveHostname: HostnameResolver = resolveWithSystemDns,
): Promise<string> {
  const parsedUrl = new URL(url);
  const port = parsedUrl.port === '' ? defaultPort(parsedUrl.protocol) : Number(parsedUrl.port);
  return resolveAllowedAddress(parsedUrl.hostname, port, networkPolicy, resolveHostname);
}

async function resolveAllowedAddress(
  hostname: string,
  port: number,
  networkPolicy: NetworkPolicy,
  resolveHostname: HostnameResolver,
): Promise<string> {
  const bareHostname = stripBrackets(hostname);
  const addresses = isIP(bareHostname) !== 0 ? [bareHostname] : await resolveHostname(bareHostname);
  if (addresses.length === 0) throw new Error(`no addresses found for ${bareHostname}`);
  for (const address of addresses) {
    if (!networkPolicy.isAllowedConnection(address, port)) throw new BlockedAddressError(bareHostname, address);
  }
  // Safe to index: the list is non-empty.
  return addresses[0]!;
}

export interface GuardedConnectorOptions {
  networkPolicy: NetworkPolicy;
  resolveHostname?: HostnameResolver;
  connectTimeoutMs?: number;
}

/**
 * An undici connector that resolves the host itself, checks every address against the
 * policy, and connects to the checked address. TLS still verifies the certificate
 * against the original hostname.
 */
export function buildGuardedConnector(options: GuardedConnectorOptions): buildConnector.connector {
  const connect = buildConnector({ timeout: options.connectTimeoutMs ?? 10_000 });
  const resolveHostname = options.resolveHostname ?? resolveWithSystemDns;

  return (connectOptions, callback) => {
    const hostname = stripBrackets(connectOptions.hostname);
    const port = connectOptions.port === '' ? defaultPort(connectOptions.protocol) : Number(connectOptions.port);
    resolveAllowedAddress(hostname, port, options.networkPolicy, resolveHostname).then(
      (address) => {
        const servername = isIP(hostname) === 0 ? hostname : undefined;
        connect({ ...connectOptions, hostname: address, servername: connectOptions.servername ?? servername }, callback);
      },
      (error: Error) => callback(error, null),
    );
  };
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * The IPv4 address inside an IPv4-mapped (::ffff:a.b.c.d), NAT64 (64:ff9b::/96) or 6to4
 * (2002::/16) address, or null for any other IPv6 address.
 */
function embeddedIpv4Address(ipv6Address: string): string | null {
  const groups = expandIpv6(ipv6Address);
  if (groups === null) return null;
  const isZero = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0);

  if (isZero(0, 5) && groups[5] === 0xffff) return ipv4FromGroups(groups[6]!, groups[7]!);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && isZero(2, 6)) return ipv4FromGroups(groups[6]!, groups[7]!);
  if (groups[0] === 0x2002) return ipv4FromGroups(groups[1]!, groups[2]!);
  return null;
}

/** Expands an IPv6 address to its eight 16-bit groups, or null if it cannot. */
function expandIpv6(ipv6Address: string): number[] | null {
  let address = ipv6Address.toLowerCase();
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);

  // A trailing dotted quad becomes two groups.
  const dottedQuad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (dottedQuad !== null) {
    const octets = dottedQuad.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    address = `${address.slice(0, dottedQuad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16)));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return groups.some((group) => Number.isNaN(group) || group < 0 || group > 0xffff) ? null : groups;
}

function ipv4FromGroups(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}
