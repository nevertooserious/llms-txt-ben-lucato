import { SiteScreen } from '@/features/site/site-screen';

// A site: its latest run, the published llms.txt and monitoring. The data is loaded and
// polled in the browser.
export default async function SitePage({ params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  return <SiteScreen publicSlug={publicSlug} />;
}
