// Submit a URL: rate-limit by IP, find or create the site, create a workspace and its
// secret link, insert a pipeline_runs row and enqueue the job on pg-boss.
export function POST(): Response {
  return Response.json({ error: 'not implemented' }, { status: 501 });
}
