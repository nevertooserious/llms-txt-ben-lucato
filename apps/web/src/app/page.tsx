import { readDemoSiteEnabled } from '@/server/composition/web-config';
import { loadDemoSitePath } from '@/server/sites/demo-site';
import { webServices } from '@/server/composition/web-services';
import { HomeScreen } from '@/features/home/home-screen';

// Whether the demo link shows is decided per request, not when the image is built.
export const dynamic = 'force-dynamic';

/** The home page must still render if the demo cannot be looked up. */
async function demoSitePath(): Promise<string | null> {
  // Checked first, so no other deployment touches the database here.
  if (!readDemoSiteEnabled()) return null;
  const services = webServices();
  try {
    return await loadDemoSitePath(services.databasePool);
  } catch (error) {
    services.logger.error('looking up the demo site failed', { error });
    return null;
  }
}

export default async function HomePage() {
  return <HomeScreen demoPath={await demoSitePath()} />;
}
