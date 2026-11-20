import { describe, it } from 'vitest';

// Fixtures will live in packages/extractor/fixtures/, one saved HTML file per case.
describe('extractPage', () => {
  it.todo('takes the title from og:title, then <title>, then the first <h1>');
  it.todo('takes the description from meta description, then og:description, then the first paragraph');
  it.todo('extracts main content from a static page');
  it.todo('extracts main content from a headless-rendered client-side app');
  it.todo('falls back to <body> without nav, header, footer and aside when there is no <main>');
  it.todo('classifies page type');
  it.todo('gives the same content_digest when only dates and numbers change');
});

describe('measureContentDensity', () => {
  it.todo('reports low density for an empty client-side app shell');
  it.todo('reports high density for a server-rendered page');
});

describe('extractLinks', () => {
  it.todo('resolves relative links against the base URL');
});
