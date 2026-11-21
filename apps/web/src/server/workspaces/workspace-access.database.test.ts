import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool, createWorkspace, findOrCreateSite } from '@llms-txt/db';
import { authoriseWorkspace, sha256Hex } from './workspace-access';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const databasePool = createDatabasePool(databaseUrl);

afterAll(() => databasePool.end());

describe('authoriseWorkspace', () => {
  it('authorises the workspace token and nothing else', async () => {
    const siteId = await findOrCreateSite(databasePool, `https://${crypto.randomUUID()}.example`);
    const accessToken = crypto.randomUUID();
    const publicSlug = crypto.randomUUID();
    const workspaceId = await createWorkspace(databasePool, {
      siteId,
      accessTokenHash: sha256Hex(accessToken),
      publicSlug,
      creatorIpHash: null,
    });

    const authorised = await authoriseWorkspace(databasePool, publicSlug, accessToken);
    expect(authorised).toMatchObject({ kind: 'authorised', workspace: { id: workspaceId, siteId } });
    expect(await authoriseWorkspace(databasePool, publicSlug, 'not-the-token')).toEqual({ kind: 'unauthorised' });
    expect(await authoriseWorkspace(databasePool, publicSlug, null)).toEqual({ kind: 'unauthorised' });
    // The token hash itself is not a token.
    expect(await authoriseWorkspace(databasePool, publicSlug, sha256Hex(accessToken))).toEqual({ kind: 'unauthorised' });
    expect(await authoriseWorkspace(databasePool, crypto.randomUUID(), accessToken)).toEqual({ kind: 'not_found' });
  });
});
