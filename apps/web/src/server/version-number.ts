/** The largest value of the Postgres `integer` column `version_number`. */
const MAX_VERSION_NUMBER = 2_147_483_647;

export function isVersionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_VERSION_NUMBER;
}

/** A version number from a URL path, or null if the text is not one. */
export function parseVersionNumber(text: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(text)) return null;
  const versionNumber = Number(text);
  return isVersionNumber(versionNumber) ? versionNumber : null;
}
