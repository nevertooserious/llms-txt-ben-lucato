import { afterAll, describe, expect, it } from 'vitest';
import { DISCOVERY_SOURCES, FETCH_METHODS, PAGE_TYPES, PIPELINE_TRIGGERS } from '@llms-txt/contracts';
import { createDatabasePool } from './database-pool';

// Runs against a database with db/schema.sql applied (the CI `schema` job).
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must point at a database with db/schema.sql applied');
const pool = createDatabasePool(databaseUrl);

afterAll(() => pool.end());

/** The values allowed by the single-column check constraint on table.column, as Postgres stores it. */
async function checkConstraintValues(tableName: string, columnName: string): Promise<string[]> {
  const result = await pool.query<{ definition: string }>(
    `select pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'c'
        and c.conrelid = $1::regclass
        and cardinality(c.conkey) = 1
        and a.attname = $2`,
    [tableName, columnName],
  );
  expect(result.rows).toHaveLength(1);
  const definition = result.rows[0]?.definition ?? '';
  return [...definition.matchAll(/'((?:[^']|'')*)'::text/g)].map((value) => (value[1] ?? '').replaceAll("''", "'"));
}

describe('contracts enums match the check constraints in the database', () => {
  it.each([
    ['pages', 'page_type', PAGE_TYPES],
    ['pages', 'fetch_method', FETCH_METHODS],
    ['pages', 'discovered_via', DISCOVERY_SOURCES],
    ['pipeline_runs', 'triggered_by', PIPELINE_TRIGGERS],
  ])('%s.%s', async (tableName, columnName, values) => {
    expect(await checkConstraintValues(tableName, columnName)).toEqual([...values]);
  });
});
