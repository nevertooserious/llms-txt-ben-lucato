import type { Queryable } from '@llms-txt/db';
import { secretLinkPath } from '../browser/saved-workspaces';
import { authoriseWorkspace } from './workspace-access';

// The workspace db/demo-seed.sql creates. Its token is public, so the seed is applied
// only by the local Docker stack, which is also what sets DEMO_WORKSPACE_ENABLED.
export const DEMO_PUBLIC_SLUG = 'demo';
export const DEMO_ACCESS_TOKEN = 'demo-workspace-token';

/** The demo's secret link, or null once the demo has been deleted or was never seeded. */
export async function loadDemoWorkspacePath(database: Queryable): Promise<string | null> {
  const authorisation = await authoriseWorkspace(database, DEMO_PUBLIC_SLUG, DEMO_ACCESS_TOKEN);
  return authorisation.kind === 'authorised' ? secretLinkPath(DEMO_PUBLIC_SLUG, DEMO_ACCESS_TOKEN) : null;
}
