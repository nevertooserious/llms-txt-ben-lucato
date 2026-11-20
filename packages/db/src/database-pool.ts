import pg from 'pg';

export type DatabasePool = pg.Pool;

export function createDatabasePool(databaseUrl: string): DatabasePool {
  return new pg.Pool({ connectionString: databaseUrl });
}
