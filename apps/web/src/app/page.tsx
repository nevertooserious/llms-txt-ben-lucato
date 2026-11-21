import { loadDemoWorkspacePath } from '../server/demo-workspace';
import { webServices } from '../server/web-services';
import { HomeScreen } from './home-screen';

// Whether the demo link shows is decided per request, not when the image is built.
export const dynamic = 'force-dynamic';

/** The home page must still render if the demo cannot be looked up. */
async function demoWorkspacePath(): Promise<string | null> {
  // Set only by docker-compose.yml. Checked first, so no other deployment touches the database here.
  if (process.env.DEMO_WORKSPACE_ENABLED !== 'true') return null;
  const services = webServices();
  try {
    return await loadDemoWorkspacePath(services.databasePool);
  } catch (error) {
    services.logger.error('looking up the demo workspace failed', { error });
    return null;
  }
}

export default async function HomePage() {
  return <HomeScreen demoPath={await demoWorkspacePath()} />;
}
