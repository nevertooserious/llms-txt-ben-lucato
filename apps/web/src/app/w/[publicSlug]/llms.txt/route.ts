// The hosted file: the workspace's published llms_txt_versions row, as text/plain.
// Site owners redirect or proxy /llms.txt on their own domain to this URL.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicSlug: string }> },
): Promise<Response> {
  const { publicSlug } = await params;
  return new Response(`No llms.txt published for ${publicSlug}\n`, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
