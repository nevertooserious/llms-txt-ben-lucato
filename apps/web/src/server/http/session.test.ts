import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  isValidSessionToken,
  pathAfterLogin,
  SESSION_LIFETIME_SECONDS,
  userIdOfSessionToken,
} from './session';

const user = { id: '3f0c1a52-7f0e-4c1b-9a53-0d6f3f1f6c11', passwordHash: 'scrypt$salt$key' };
const now = new Date('2026-01-01T00:00:00Z');
const secondsLater = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe('isValidSessionToken', () => {
  const token = createSessionToken(user, now);

  it('accepts a token until it expires', () => {
    expect(isValidSessionToken(token, user, now)).toBe(true);
    expect(isValidSessionToken(token, user, secondsLater(SESSION_LIFETIME_SECONDS - 1))).toBe(true);
    expect(isValidSessionToken(token, user, secondsLater(SESSION_LIFETIME_SECONDS))).toBe(false);
  });

  it('names the user it was issued for', () => {
    expect(userIdOfSessionToken(token)).toBe(user.id);
  });

  it('refuses a token once the user has another password', () => {
    expect(isValidSessionToken(token, { ...user, passwordHash: 'scrypt$salt$changed' }, now)).toBe(false);
  });

  it('refuses a token issued for another user, even one with the same password hash', () => {
    const otherUser = { ...user, id: '9d2b7c64-1a3e-4f5b-8c7d-2e1f0a9b8c7d' };
    expect(isValidSessionToken(token, otherUser, now)).toBe(false);
    const renamed = token.replace(user.id, otherUser.id);
    expect(isValidSessionToken(renamed, otherUser, now)).toBe(false);
  });

  it('refuses a token whose expiry was moved', () => {
    const [userId, expiresAt, signature] = token.split('.');
    expect(isValidSessionToken(`${userId}.${Number(expiresAt) + 1}.${signature}`, user, now)).toBe(false);
  });

  it.each([
    ['no cookie', undefined],
    ['an empty cookie', ''],
    ['no user', `9999999999.${'a'.repeat(64)}`],
    ['no signature', `${user.id}.9999999999`],
    ['a short signature', `${user.id}.9999999999.abc`],
    ['a signature that is not hex', `${user.id}.9999999999.${'z'.repeat(64)}`],
  ])('refuses %s', (_name, value) => {
    expect(isValidSessionToken(value, user, now)).toBe(false);
    if (value !== `${user.id}.9999999999.${'z'.repeat(64)}`) expect(userIdOfSessionToken(value)).toBeNull();
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
