import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openapi-document';

const APP_DIRECTORY = fileURLToPath(new URL('../../app', import.meta.url));
/** The document's own route, which it does not describe. */
const UNDOCUMENTED_ROUTES = new Set(['/api/openapi.json']);
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

/** Every `METHOD /path` the API routes export, with `[param]` written as `{param}`. */
function routeOperations(): string[] {
  const routeFiles = readdirSync(APP_DIRECTORY, { recursive: true, encoding: 'utf8' }).filter(
    (file) => path.basename(file) === 'route.ts',
  );
  return routeFiles.flatMap((file) => {
    const routePath = `/${path.dirname(file).split(path.sep).join('/')}`.replace(/\[(\w+)\]/g, '{$1}');
    if (UNDOCUMENTED_ROUTES.has(routePath)) return [];
    const source = readFileSync(path.join(APP_DIRECTORY, file), 'utf8');
    return [...source.matchAll(/export async function (GET|PUT|POST|DELETE|PATCH|HEAD|OPTIONS)\b/g)].map(
      (match) => `${match[1]} ${routePath}`,
    );
  });
}

function documentedOperations(): string[] {
  return Object.entries(openApiDocument.paths).flatMap(([routePath, item]) =>
    Object.keys(item)
      .filter((key) => HTTP_METHODS.includes(key))
      .map((method) => `${method.toUpperCase()} ${routePath}`),
  );
}

/** Every `$ref` anywhere in a JSON value. */
function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : references(child),
  );
}

describe('the OpenAPI document', () => {
  it('lists exactly the routes the app serves', () => {
    expect(documentedOperations().sort()).toEqual(routeOperations().sort());
  });

  it('declares every path parameter', () => {
    for (const [routePath, item] of Object.entries(openApiDocument.paths)) {
      const inPath = [...routePath.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      const declared = ('parameters' in item ? item.parameters : []).map((parameter) => parameter.name);
      expect(declared, routePath).toEqual(inPath);
    }
  });

  it('only refers to components it defines', () => {
    for (const target of references(openApiDocument)) {
      const [, section, name] = /^#\/components\/(\w+)\/(\w+)$/.exec(target) ?? [];
      const components = openApiDocument.components as unknown as Record<string, Record<string, unknown>>;
      expect(components[section ?? '']?.[name ?? ''], target).toBeDefined();
    }
  });

  it('leaves only the hosted file public', () => {
    const publicOperations = Object.entries(openApiDocument.paths).flatMap(([routePath, item]) =>
      Object.entries(item)
        .filter(([key, operation]) => HTTP_METHODS.includes(key) && (operation as { security?: unknown[] }).security?.length === 0)
        .map(([key]) => `${key.toUpperCase()} ${routePath}`),
    );
    expect(publicOperations).toEqual(['GET /w/{publicSlug}/llms.txt']);
  });
});
