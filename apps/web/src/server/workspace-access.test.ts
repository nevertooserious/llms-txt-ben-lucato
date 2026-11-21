import { describe, expect, it } from 'vitest';
import { bearerTokenFrom } from './workspace-access';

describe('bearerTokenFrom', () => {
  it('reads a bearer token', () => {
    expect(bearerTokenFrom(new Headers({ authorization: 'Bearer abc-123_x' }))).toBe('abc-123_x');
    expect(bearerTokenFrom(new Headers({ authorization: 'bearer abc' }))).toBe('abc');
  });

  it('is null for a missing header or another scheme', () => {
    expect(bearerTokenFrom(new Headers())).toBeNull();
    expect(bearerTokenFrom(new Headers({ authorization: 'Basic dXNlcjpwYXNz' }))).toBeNull();
    expect(bearerTokenFrom(new Headers({ authorization: 'Bearer ' }))).toBeNull();
  });
});
