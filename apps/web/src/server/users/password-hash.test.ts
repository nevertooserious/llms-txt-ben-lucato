import { describe, expect, it } from 'vitest';
import { hashPassword, isPasswordCorrect } from './password-hash';

describe('hashPassword', () => {
  it('makes a hash only the same password matches', async () => {
    const passwordHash = await hashPassword('pass1');
    expect(passwordHash).toMatch(/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await isPasswordCorrect('pass1', passwordHash)).toBe(true);
    expect(await isPasswordCorrect('pass2', passwordHash)).toBe(false);
    expect(await isPasswordCorrect('', passwordHash)).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await hashPassword('pass1')).not.toBe(await hashPassword('pass1'));
  });

  it.each(['', 'pass1', 'set by the web app at startup', 'scrypt$$', 'scrypt$c2FsdA$c2hvcnQ'])(
    'matches nothing against %j, which is not a hash',
    async (stored) => {
      expect(await isPasswordCorrect('pass1', stored)).toBe(false);
    },
  );
});
