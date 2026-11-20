import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_SOURCES, FETCH_METHODS, PAGE_TYPES, PIPELINE_TRIGGERS } from '@llms-txt/contracts';

const schemaSql = readFileSync(fileURLToPath(new URL('../../../db/schema.sql', import.meta.url)), 'utf8');

/** The quoted values in `check (<column> in (...))` for the given column. */
function checkConstraintValues(columnName: string): string[] {
  const match = new RegExp(`check \\(${columnName} in\\s*\\(([^)]*)\\)`).exec(schemaSql);
  if (!match?.[1]) throw new Error(`no check constraint found for ${columnName}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1] ?? '');
}

describe('contracts enums match db/schema.sql', () => {
  it.each([
    ['page_type', PAGE_TYPES],
    ['fetch_method', FETCH_METHODS],
    ['discovered_via', DISCOVERY_SOURCES],
    ['triggered_by', PIPELINE_TRIGGERS],
  ])('%s', (columnName, values) => {
    expect(checkConstraintValues(columnName)).toEqual([...values]);
  });
});
