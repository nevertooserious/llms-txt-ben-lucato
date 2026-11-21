import { loadPublishedLlmsTxt } from '@llms-txt/db';
import { webServices } from '@/server/composition/web-services';

// The hosted file: the workspace's published llms_txt_versions row, as text/plain.
// Site owners redirect or proxy /llms.txt on their own domain to this URL.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const { publicSlug } = await params;
  const headers = { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' };
  const llmsTxt = await loadPublishedLlmsTxt(webServices().databasePool, publicSlug);
  if (llmsTxt === null) return new Response('No llms.txt has been published here.\n', { status: 404, headers });
  return new Response(llmsTxt, { status: 200, headers });
}
