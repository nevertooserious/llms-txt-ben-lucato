import { readDemoSiteEnabled } from '@/server/composition/web-config';
import { webServices } from '@/server/composition/web-services';
import { signedInUserId } from '@/server/http/signed-in-page-user';
import { loadDemoSitePath } from '@/server/sites/demo-site';
import { listSites } from '@/server/sites/list-sites';
import { HomeScreen } from '@/features/home/home-screen';

// The user's sites and whether the demo link shows are decided per request, not when
// the image is built.
export const dynamic = 'force-dynamic';

/** The home page must still render if the demo cannot be looked up. */
async function demoSitePath(userId: string): Promise<string | null> {
  // Checked first, so no other deployment touches the database here.
  if (!readDemoSiteEnabled()) return null;
  const services = webServices();
  try {
    return await loadDemoSitePath(services.databasePool, userId);
  } catch (error) {
    services.logger.error('looking up the demo site failed', { error });
    return null;
  }
}

export default async function HomePage() {
  // src/proxy.ts lets nobody here signed out; without a user there is nothing to list.
  const userId = await signedInUserId();
  if (userId === null) return <HomeScreen sites={[]} demoPath={null} />;
  const [sites, demoPath] = await Promise.all([listSites(webServices().databasePool, userId), demoSitePath(userId)]);
  return <HomeScreen sites={sites} demoPath={demoPath} />;
}
