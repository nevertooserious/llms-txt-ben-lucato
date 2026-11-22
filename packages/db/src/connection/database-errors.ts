/** Postgres's code for a write that a unique constraint or index refused. */
const UNIQUE_VIOLATION_CODE = '23505';

/** True if a query failed because the row it wrote already exists. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE;
}
