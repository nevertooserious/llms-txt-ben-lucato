import { describe, expect, it } from 'vitest';
import { clientIpFrom } from './client-ip';

const forwardedFor = (value: string) => new Headers({ 'x-forwarded-for': value });

describe('clientIpFrom', () => {
  it('ignores entries the client sent ahead of the trusted proxy', () => {
    expect(clientIpFrom(forwardedFor('1.1.1.1, 2.2.2.2, 203.0.113.9'))).toBe('203.0.113.9');
  });

  it('counts back by the number of trusted proxies', () => {
    expect(clientIpFrom(forwardedFor('1.1.1.1, 203.0.113.9, 10.0.0.1'), 2)).toBe('203.0.113.9');
  });

  it('uses the first entry when there are fewer entries than proxies', () => {
    expect(clientIpFrom(forwardedFor('203.0.113.9'), 2)).toBe('203.0.113.9');
  });

  it('is null without the header', () => {
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});
