import { describe, it } from 'vitest';

describe('generateLlmsTxt', () => {
  it.todo('renders the same text for the same input');
  it.todo('derives H2 sections from page type');
  it.todo('puts low-scoring pages under an H2 named Optional');
  it.todo('applies description overrides and exclusions');
  it.todo('links the .md variant when one exists');
  it.todo('leaves out pages with a noindex directive');
  it.todo('escapes brackets in titles and keeps each entry on one line');
});

describe('validateLlmsTxt', () => {
  it.todo('accepts a file with only an H1');
  it.todo('rejects H3 headings');
  it.todo('rejects multi-line entries');
});
