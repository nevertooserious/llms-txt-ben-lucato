import { WorkspaceScreen } from '@/features/workspace/workspace-screen';

// A workspace: its latest run, the published llms.txt and monitoring. The data is
// loaded in the browser, because the secret token is in the URL fragment.
export default async function WorkspacePage({ params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  return <WorkspaceScreen publicSlug={publicSlug} />;
}
