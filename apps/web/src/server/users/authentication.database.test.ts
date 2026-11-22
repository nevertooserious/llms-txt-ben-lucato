import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool, createSite, createUserIfAbsent, loadOwnedSiteIdBySlug } from '@llms-txt/db';
import { createSessionToken } from '../http/session';
import { listSites } from '../sites/list-sites';
import { ensureConfiguredUser, userIdOfRequest, userWithLogin } from './authentication';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

const newLogin = () => ({ username: `user-${randomUUID()}`, password: 'pass1' });
const basicHeader = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

describe('ensureConfiguredUser', () => {
  it('creates the user once and returns the same one afterwards', async () => {
    const login = newLogin();
    const created = await ensureConfiguredUser(databasePool, login);
    const again = await ensureConfiguredUser(databasePool, login);
    expect(again).toEqual(created);
    expect(created.passwordHash).not.toContain(login.password);
  });

  it('replaces the stored password when the configured one changes, which ends the old sessions', async () => {
    const login = newLogin();
    const before = await ensureConfiguredUser(databasePool, login);
    const oldSession = createSessionToken(before);
    const after = await ensureConfiguredUser(databasePool, { ...login, password: 'changed' });

    expect(after.id).toBe(before.id);
    expect(await userWithLogin(databasePool, login.username, 'pass1')).toBeNull();
    expect((await userWithLogin(databasePool, login.username, 'changed'))?.id).toBe(before.id);
    expect(await userIdOfRequest(databasePool, { authorizationHeader: null, sessionToken: oldSession })).toBeNull();
  });

  it('gives a user seeded without a usable password the configured one', async () => {
    const login = newLogin();
    const seeded = await createUserIfAbsent(databasePool, {
      username: login.username,
      passwordHash: 'set by the web app at startup',
    });
    expect(await userWithLogin(databasePool, login.username, login.password)).toBeNull();
    expect((await ensureConfiguredUser(databasePool, login)).id).toBe(seeded.id);
    expect((await userWithLogin(databasePool, login.username, login.password))?.id).toBe(seeded.id);
  });
});

describe('userIdOfRequest', () => {
  it('knows the user by Basic auth or by their session cookie, and nobody otherwise', async () => {
    const login = newLogin();
    const user = await ensureConfiguredUser(databasePool, login);
    const none = { authorizationHeader: null, sessionToken: undefined };

    expect(await userIdOfRequest(databasePool, none)).toBeNull();
    expect(
      await userIdOfRequest(databasePool, { ...none, authorizationHeader: basicHeader(login.username, login.password) }),
    ).toBe(user.id);
    expect(
      await userIdOfRequest(databasePool, { ...none, authorizationHeader: basicHeader(login.username, 'wrong') }),
    ).toBeNull();
    expect(
      await userIdOfRequest(databasePool, { ...none, authorizationHeader: basicHeader('nobody', login.password) }),
    ).toBeNull();
    expect(await userIdOfRequest(databasePool, { ...none, sessionToken: createSessionToken(user) })).toBe(user.id);
  });

  it('refuses a session cookie for a user who does not exist', async () => {
    const ghost = { id: randomUUID(), passwordHash: 'scrypt$salt$key' };
    expect(
      await userIdOfRequest(databasePool, { authorizationHeader: null, sessionToken: createSessionToken(ghost) }),
    ).toBeNull();
  });
});

describe('a site', () => {
  it('is found and listed only for the user who owns it', async () => {
    const owner = await ensureConfiguredUser(databasePool, newLogin());
    const other = await ensureConfiguredUser(databasePool, newLogin());
    const publicSlug = randomUUID();
    const rootUrl = `https://${randomUUID()}.example`;
    const siteId = await createSite(databasePool, { ownerUserId: owner.id, rootUrl, publicSlug });

    expect(await loadOwnedSiteIdBySlug(databasePool, publicSlug, owner.id)).toBe(siteId);
    expect(await loadOwnedSiteIdBySlug(databasePool, publicSlug, other.id)).toBeNull();
    expect(await listSites(databasePool, owner.id)).toMatchObject([{ publicSlug, rootUrl }]);
    expect(await listSites(databasePool, other.id)).toEqual([]);
  });
});
