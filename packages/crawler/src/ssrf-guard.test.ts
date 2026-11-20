import { describe, expect, it } from 'vitest';
import { assertPublicAddress, BlockedAddressError, isBlockedAddress, type HostnameResolver } from './ssrf-guard';

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('blocks loopback, private, link-local and reserved IPv4: %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['::', '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fdaa::2', 'fe80::1', 'fe80::1%eth0', 'ff02::1'])(
    'blocks IPv6 loopback, unique-local and link-local: %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    },
  );

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::FFFF:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '0:0:0:0:0:ffff:10.0.0.1',
    '64:ff9b::10.0.0.1',
    '2002:c0a8:0101::1',
    '::127.0.0.1',
  ])('blocks IPv6 forms that embed a private IPv4 address: %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public addresses: %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it.each(['', 'localhost', 'example.com', '999.1.1.1', '1.2.3'])('blocks anything that is not an IP: %s', (value) => {
    expect(isBlockedAddress(value)).toBe(true);
  });
});

describe('assertPublicAddress', () => {
  const resolveTo =
    (addresses: string[]): HostnameResolver =>
    async () =>
      addresses;

  it('returns the address of a public host', async () => {
    await expect(
      assertPublicAddress('https://example.com/', undefined, resolveTo(['93.184.216.34'])),
    ).resolves.toBe('93.184.216.34');
  });

  it('refuses a hostname that resolves to a private address', async () => {
    await expect(
      assertPublicAddress('https://internal.example.com/', undefined, resolveTo(['10.0.0.5'])),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('refuses a hostname with both public and private addresses', async () => {
    await expect(
      assertPublicAddress('https://mixed.example.com/', undefined, resolveTo(['93.184.216.34', '127.0.0.1'])),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('refuses IP literals without a DNS lookup', async () => {
    const neverCalled: HostnameResolver = async () => {
      throw new Error('resolver should not be called');
    };
    await expect(assertPublicAddress('http://169.254.169.254/latest/', undefined, neverCalled)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await expect(assertPublicAddress('http://[::ffff:127.0.0.1]/', undefined, neverCalled)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
  });

  it('passes the port to the policy', async () => {
    const allowOnly8080 = { isAllowedConnection: (_address: string, port: number) => port === 8080 };
    await expect(assertPublicAddress('http://127.0.0.1:8080/', allowOnly8080)).resolves.toBe('127.0.0.1');
    await expect(assertPublicAddress('http://127.0.0.1:8081/', allowOnly8080)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await expect(assertPublicAddress('http://127.0.0.1/', allowOnly8080)).rejects.toBeInstanceOf(BlockedAddressError);
  });
});
