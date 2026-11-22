import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// How a password is stored in `users.password_hash`: "scrypt$<salt>$<key>", both
// base64url, with Node's default scrypt cost.

const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const key = await deriveKey(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** False for a wrong password and for a stored value that is not a hash at all. */
export async function isPasswordCorrect(password: string, passwordHash: string): Promise<boolean> {
  const match = /^scrypt\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(passwordHash);
  if (!match) return false;
  const expectedKey = Buffer.from(match[2]!, 'base64url');
  if (expectedKey.length !== KEY_LENGTH_BYTES) return false;
  const key = await deriveKey(password, Buffer.from(match[1]!, 'base64url'));
  return timingSafeEqual(key, expectedKey);
}
