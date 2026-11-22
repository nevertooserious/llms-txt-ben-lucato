import { isUrlUnderPrefix, type GeneratorPage, type PageOverride } from '@llms-txt/contracts';

/**
 * The user's overrides with every page at or under one of the excluded URL prefixes
 * excluded too. The prefixes are applied to the pages of each render, so they cover
 * pages found after the user set them. A page's description override is kept.
 */
export function excludePagesUnderUrlPrefixes(
  overrides: readonly PageOverride[],
  excludedUrlPrefixes: readonly string[],
  pages: readonly GeneratorPage[],
): PageOverride[] {
  if (excludedUrlPrefixes.length === 0) return [...overrides];
  const overridesByUrl = new Map(overrides.map((override) => [override.normalisedUrl, override]));
  for (const { record } of pages) {
    if (!excludedUrlPrefixes.some((urlPrefix) => isUrlUnderPrefix(record.normalisedUrl, urlPrefix))) continue;
    overridesByUrl.set(record.normalisedUrl, {
      normalisedUrl: record.normalisedUrl,
      descriptionOverride: overridesByUrl.get(record.normalisedUrl)?.descriptionOverride ?? null,
      isExcluded: true,
      isKept: overridesByUrl.get(record.normalisedUrl)?.isKept ?? false,
    });
  }
  return [...overridesByUrl.values()];
}
