import type pg from 'pg';
import type { DatabasePool } from './database-pool';

/** A pool, or a client inside a transaction. Query functions that need no atomicity take either. */
export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<Row>>;
}

declare const transactionBrand: unique symbol;

/**
 * A client inside an open transaction. Functions whose writes must land together with the
 * caller's (a run and its queue job, a version and the pointer to it) take this type, so
 * they cannot be called on a bare pool by mistake.
 */
export interface Transaction extends Queryable {
  readonly [transactionBrand]: true;
}

/** Runs `work` in a transaction: committed if it resolves, rolled back if it throws. */
export async function withTransaction<Result>(
  pool: DatabasePool,
  work: (transaction: Transaction) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  let connectionIsBroken = false;
  try {
    await client.query('begin');
    const result = await work(client as unknown as Transaction);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => (connectionIsBroken = true));
    throw error;
  } finally {
    // A connection whose rollback failed may still be inside the transaction; drop it.
    client.release(connectionIsBroken);
  }
}
