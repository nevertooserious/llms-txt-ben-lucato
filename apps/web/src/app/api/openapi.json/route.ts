import { openApiDocument } from '@/server/http/openapi-document';

// The API's OpenAPI description, which the Swagger UI on /api-docs reads.
export async function GET(): Promise<Response> {
  return Response.json(openApiDocument, { headers: { 'cache-control': 'no-store' } });
}
