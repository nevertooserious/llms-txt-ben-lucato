import { describe, expect, it } from 'vitest';
import { isVersionNumber, parseVersionNumber } from './version-number';

describe('parseVersionNumber', () => {
  it('reads a positive whole number', () => {
    expect(parseVersionNumber('1')).toBe(1);
    expect(parseVersionNumber('2147483647')).toBe(2_147_483_647);
  });

  it.each(['0', '-1', '01', '1.5', 'two', '', '2147483648', '99999999999'])('refuses %j', (text) => {
    expect(parseVersionNumber(text)).toBeNull();
  });
});

describe('isVersionNumber', () => {
  it.each([0, -1, 1.5, 2 ** 31, '1', null])('refuses %j', (value) => {
    expect(isVersionNumber(value)).toBe(false);
  });
});
