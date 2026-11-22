import {
  createUserIfAbsent,
  loadUserById,
  loadUserByUsername,
  saveUserPasswordHash,
  type Queryable,
  type StoredUser,
} from '@llms-txt/db';
import { basicAuthLogin, type BasicAuthCredentials } from '../http/basic-auth';
import { isValidSessionToken, userIdOfSessionToken } from '../http/session';
import { hashPassword, isPasswordCorrect } from './password-hash';

// Who a request is from. Users are rows in `users`; there is no sign-up, so the only one
// is the user made from the configured login (ensureConfiguredUser).

/**
 * The user for the configured login, created on first use. If the configured password
 * no longer matches the stored one, the stored one is replaced, which also ends that
 * user's sessions. A changed username makes a new user, who does not own the old one's sites.
 */
export async function ensureConfiguredUser(database: Queryable, credentials: BasicAuthCredentials): Promise<StoredUser> {
  const existing = await loadUserByUsername(database, credentials.username);
  if (existing === null) {
    return createUserIfAbsent(database, {
      username: credentials.username,
      passwordHash: await hashPassword(credentials.password),
    });
  }
  if (await isPasswordCorrect(credentials.password, existing.passwordHash)) return existing;
  const passwordHash = await hashPassword(credentials.password);
  await saveUserPasswordHash(database, existing.id, passwordHash);
  return { ...existing, passwordHash };
}

/** Compared against when there is no such user, so a wrong username takes as long as a wrong password. */
let unusedPasswordHash: Promise<string> | null = null;

/** The user with this username and password, or null. */
export async function userWithLogin(database: Queryable, username: string, password: string): Promise<StoredUser | null> {
  const user = await loadUserByUsername(database, username);
  if (user === null) {
    unusedPasswordHash ??= hashPassword('no user has this password');
    await isPasswordCorrect(password, await unusedPasswordHash);
    return null;
  }
  return (await isPasswordCorrect(password, user.passwordHash)) ? user : null;
}

export interface PresentedLogin {
  /** The `Authorization` header, which API clients send. */
  authorizationHeader: string | null;
  /** The cookie the login page sets. */
  sessionToken: string | undefined;
}

/** The id of the user a request is from, by its session cookie or else HTTP Basic auth; null if neither holds. */
export async function userIdOfRequest(
  database: Queryable,
  presented: PresentedLogin,
  now: Date = new Date(),
): Promise<string | null> {
  const sessionUserId = userIdOfSessionToken(presented.sessionToken);
  if (sessionUserId !== null) {
    const user = await loadUserById(database, sessionUserId);
    if (user !== null && isValidSessionToken(presented.sessionToken, user, now)) return user.id;
  }
  const login = basicAuthLogin(presented.authorizationHeader);
  if (login === null) return null;
  return (await userWithLogin(database, login.username, login.password))?.id ?? null;
}
