// Database access. db/schema.sql is the source of truth for the schema; queries here
// are hand-written SQL over node-postgres.
export { createDatabasePool, type DatabasePool } from './database-pool';
