import { describe, expect, it } from 'vitest';
import { createSessionToken, isValidSessionToken, pathAfterLogin, SESSION_LIFETIME_SECONDS } from './session';

const credentials = { username: 'user1', password: 'pass1' };
const now = new Date('2026-01-01T00:00:00Z');
const secondsLater = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe('isValidSessionToken', () => {
  const token = createSessionToken(credentials, now);

  it('accepts a token until it expires', () => {
    expect(isValidSessionToken(token, credentials, now)).toBe(true);
    expect(isValidSessionToken(token, credentials, secondsLater(SESSION_LIFETIME_SECONDS - 1))).toBe(true);
    expect(isValidSessionToken(token, credentials, secondsLater(SESSION_LIFETIME_SECONDS))).toBe(false);
  });

  it('refuses a token issued for another username or password', () => {
    expect(isValidSessionToken(token, { ...credentials, password: 'changed' }, now)).toBe(false);
    expect(isValidSessionToken(token, { ...credentials, username: 'changed' }, now)).toBe(false);
  });

  it('refuses a token whose expiry was moved', () => {
    const [expiresAt, signature] = token.split('.');
    expect(isValidSessionToken(`${Number(expiresAt) + 1}.${signature}`, credentials, now)).toBe(false);
  });

  it.each([
    ['no cookie', undefined],
    ['an empty cookie', ''],
    ['no signature', '9999999999'],
    ['a short signature', '9999999999.abc'],
    ['a signature that is not hex', `9999999999.${'z'.repeat(64)}`],
  ])('refuses %s', (_name, value) => {
    expect(isValidSessionToken(value, credentials, now)).toBe(false);
  });
});

describe('pathAfterLogin', () => {
  it.each(['/', '/w/abc', '/w/abc?tab=pages'])('keeps %s', (path) => {
    expect(pathAfterLogin(path)).toBe(path);
  });

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['another site', 'https://example.com/'],
    ['a protocol-relative URL', '//example.com'],
    ['a backslash after the slash', '/\\example.com'],
    ['a relative path', 'w/abc'],
    ['a line break', '/w/abc\nx'],
    ['the login page', '/login'],
    ['the login page with a query', '/login?next=/login'],
  ])('sends %s home', (_name, requested) => {
    expect(pathAfterLogin(requested)).toBe('/');
  });
});
