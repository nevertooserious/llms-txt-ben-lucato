import type {
  AssessedPageType,
  DiscoverySource,
  FetchMethod,
  GeneratorPage,
  LinkSignals,
  PageExclusionReason,
  PageListingValue,
  PageScope,
  PageRecord,
  PageType,
  StoredPageAssessment,
} from '@llms-txt/contracts';
import type { Queryable } from '../connection/transaction';

// The pages table. Its columns are in groups with one writer each (db/schema.sql), and
// each write function below sets only its group:
//
//   saveCrawledPage, saveLinkSignals   crawler columns and lifecycle
//   saveExtractedPage                  extractor columns
//   savePageAssessment                 generator columns

/** Everything the run needs to know about a stored page before it is fetched again. */
export interface StoredPage {
  normalisedUrl: string;
  fetchUrl: string;
  httpStatusCode: number | null;
  httpEtag: string | null;
  httpLastModified: string | null;
  fetchMethod: FetchMethod;
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  /** ISO 8601. */
  sitemapLastModifiedAt: string | null;
  markdownVariantUrl: string | null;
  /** The page's links when it was last read; null if it has not been read yet. */
  outboundLinkUrls: string[] | null;
  hasNoindexDirective: boolean;
  /** ISO 8601; null while the page is listed. */
  removedAt: string | null;
  contentDigest: string | null;
  listingFieldsHash: string | null;
}

export async function loadStoredPages(database: Queryable, siteId: string): Promise<StoredPage[]> {
  const result = await database.query<{
    normalised_url: string;
    fetch_url: string;
    http_status_code: number | null;
    http_etag: string | null;
    http_last_modified: string | null;
    fetch_method: FetchMethod;
    crawl_depth: number;
    discovered_via: DiscoverySource;
    sitemap_last_modified_at: Date | null;
    markdown_variant_url: string | null;
    outbound_link_urls: string[] | null;
    has_noindex_directive: boolean;
    removed_at: Date | null;
    content_digest: string | null;
    listing_fields_hash: string | null;
  }>(
    `select normalised_url, fetch_url, http_status_code, http_etag, http_last_modified, fetch_method,
            crawl_depth, discovered_via, sitemap_last_modified_at, markdown_variant_url,
            outbound_link_urls, has_noindex_directive, removed_at, content_digest,
            listing_fields_hash
       from pages
      where site_id = $1`,
    [siteId],
  );
  return result.rows.map((row) => ({
    normalisedUrl: row.normalised_url,
    fetchUrl: row.fetch_url,
    httpStatusCode: row.http_status_code,
    httpEtag: row.http_etag,
    httpLastModified: row.http_last_modified,
    fetchMethod: row.fetch_method,
    crawlDepth: row.crawl_depth,
    discoveredVia: row.discovered_via,
    sitemapLastModifiedAt: row.sitemap_last_modified_at?.toISOString() ?? null,
    markdownVariantUrl: row.markdown_variant_url,
    outboundLinkUrls: row.outbound_link_urls,
    hasNoindexDirective: row.has_noindex_directive,
    removedAt: row.removed_at?.toISOString() ?? null,
    contentDigest: row.content_digest,
    listingFieldsHash: row.listing_fields_hash,
  }));
}

/** The crawler's column group and the lifecycle columns, as one fetch leaves them. */
export interface CrawledPageWrite {
  normalisedUrl: string;
  fetchUrl: string;
  httpStatusCode: number;
  httpEtag: string | null;
  httpLastModified: string | null;
  fetchMethod: FetchMethod;
  crawlDepth: number;
  discoveredVia: DiscoverySource;
  /** ISO 8601. */
  sitemapLastModifiedAt: string | null;
  markdownVariantUrl: string | null;
  /** The links this fetch read; null keeps the stored ones (a 304 or an error). */
  outboundLinkUrls: string[] | null;
  hasNoindexDirective: boolean;
  /** ISO 8601. */
  removedAt: string | null;
}

/** Inserts or updates one page's crawler and lifecycle columns, stamping the fetch time. */
export async function saveCrawledPage(
  database: Queryable,
  siteId: string,
  pipelineRunId: string,
  page: CrawledPageWrite,
): Promise<void> {
  await database.query(
    `insert into pages (
       site_id, normalised_url, fetch_url, http_status_code, http_etag, http_last_modified,
       last_fetched_at, fetch_method, crawl_depth, discovered_via, sitemap_last_modified_at,
       markdown_variant_url, has_noindex_directive, removed_at,
       first_seen_pipeline_run_id, last_seen_pipeline_run_id, outbound_link_urls)
     values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12, $13, $14, $14, $15)
     on conflict (site_id, normalised_url) do update set
       fetch_url = excluded.fetch_url,
       http_status_code = excluded.http_status_code,
       http_etag = excluded.http_etag,
       http_last_modified = excluded.http_last_modified,
       last_fetched_at = excluded.last_fetched_at,
       fetch_method = excluded.fetch_method,
       crawl_depth = excluded.crawl_depth,
       discovered_via = excluded.discovered_via,
       sitemap_last_modified_at = excluded.sitemap_last_modified_at,
       markdown_variant_url = excluded.markdown_variant_url,
       has_noindex_directive = excluded.has_noindex_directive,
       removed_at = excluded.removed_at,
       last_seen_pipeline_run_id = excluded.last_seen_pipeline_run_id,
       outbound_link_urls = coalesce(excluded.outbound_link_urls, pages.outbound_link_urls)`,
    [
      siteId,
      page.normalisedUrl,
      page.fetchUrl,
      page.httpStatusCode,
      page.httpEtag,
      page.httpLastModified,
      page.fetchMethod,
      page.crawlDepth,
      page.discoveredVia,
      page.sitemapLastModifiedAt,
      page.markdownVariantUrl,
      page.hasNoindexDirective,
      page.removedAt,
      pipelineRunId,
      page.outboundLinkUrls,
    ],
  );
}

/**
 * Writes the link signals the crawl only knows at its end. Pages not listed keep theirs.
 * The crawl computes them from every page's current links, so unchanged links give
 * unchanged values however few pages a check re-read.
 */
export async function saveLinkSignals(
  database: Queryable,
  siteId: string,
  linkSignals: Record<string, LinkSignals>,
): Promise<void> {
  const entries = Object.entries(linkSignals);
  if (entries.length === 0) return;
  await database.query(
    `update pages
        set is_in_site_navigation = signals.is_in_site_navigation,
            inbound_link_count = signals.inbound_link_count,
            navigation_label = signals.navigation_label,
            navigation_position = signals.navigation_position,
            first_link_position = signals.first_link_position
       from unnest($2::text[], $3::boolean[], $4::integer[], $5::text[], $6::integer[], $7::integer[])
            as signals (normalised_url, is_in_site_navigation, inbound_link_count, navigation_label,
                        navigation_position, first_link_position)
      where pages.site_id = $1 and pages.normalised_url = signals.normalised_url`,
    [
      siteId,
      entries.map(([url]) => url),
      entries.map(([, signals]) => signals.isInSiteNavigation),
      entries.map(([, signals]) => signals.inboundLinkCount),
      entries.map(([, signals]) => signals.navigationLabel),
      entries.map(([, signals]) => signals.navigationPosition),
      entries.map(([, signals]) => signals.firstLinkPosition),
    ],
  );
}

/** Writes the extractor's column group for a page the crawler has already saved. */
export async function saveExtractedPage(database: Queryable, siteId: string, record: PageRecord): Promise<void> {
  await database.query(
    `update pages
        set canonical_url = $3, extracted_title = $4, extracted_description = $5, page_type = $6,
            language_code = $7, content_markdown = $8, content_digest = $9, listing_fields_hash = $10,
            declared_site_name = $11, last_extracted_at = now()
      where site_id = $1 and normalised_url = $2`,
    [
      siteId,
      record.normalisedUrl,
      record.canonicalUrl,
      record.title,
      record.description,
      record.pageType,
      record.languageCode,
      record.contentMarkdown,
      record.contentDigest,
      record.listingFieldsHash,
      record.declaredSiteName,
    ],
  );
}

/** Writes the generator's column group: one page's LLM assessment and the hash of its inputs. */
export async function savePageAssessment(
  database: Queryable,
  siteId: string,
  normalisedUrl: string,
  assessment: StoredPageAssessment,
): Promise<void> {
  await database.query(
    `update pages
        set generated_description = $3, assessed_page_type = $4, listing_value = $5,
            exclusion_reason = $6, assessment_source_hash = $7, assessed_page_scope = $8
      where site_id = $1 and normalised_url = $2`,
    [
      siteId,
      normalisedUrl,
      assessment.description,
      assessment.pageType,
      assessment.listingValue,
      assessment.exclusionReason,
      assessment.sourceHash,
      assessment.scope,
    ],
  );
}

/** The generator's input: every listed page that has been extracted. */
export async function loadGeneratorPages(database: Queryable, siteId: string): Promise<GeneratorPage[]> {
  const result = await database.query<{
    normalised_url: string;
    fetch_url: string;
    canonical_url: string | null;
    extracted_title: string | null;
    extracted_description: string | null;
    declared_site_name: string | null;
    page_type: PageType;
    language_code: string | null;
    content_markdown: string;
    content_digest: string;
    listing_fields_hash: string;
    crawl_depth: number;
    discovered_via: DiscoverySource;
    is_in_site_navigation: boolean;
    inbound_link_count: number;
    navigation_label: string | null;
    navigation_position: number | null;
    first_link_position: number | null;
    has_noindex_directive: boolean;
    markdown_variant_url: string | null;
    generated_description: string | null;
    assessed_page_type: AssessedPageType | null;
    listing_value: PageListingValue | null;
    exclusion_reason: PageExclusionReason | null;
    assessed_page_scope: PageScope | null;
    assessment_source_hash: string | null;
  }>(
    `select normalised_url, fetch_url, canonical_url, extracted_title, extracted_description,
            declared_site_name, page_type, language_code, content_markdown, content_digest,
            listing_fields_hash, crawl_depth, discovered_via, is_in_site_navigation,
            inbound_link_count, navigation_label, navigation_position, first_link_position,
            has_noindex_directive,
            markdown_variant_url, generated_description, assessed_page_type, listing_value,
            exclusion_reason, assessed_page_scope, assessment_source_hash
       from pages
      where site_id = $1 and removed_at is null and last_extracted_at is not null
      order by normalised_url`,
    [siteId],
  );
  return result.rows.map((row) => ({
    record: {
      normalisedUrl: row.normalised_url,
      canonicalUrl: row.canonical_url,
      title: row.extracted_title,
      description: row.extracted_description,
      declaredSiteName: row.declared_site_name,
      pageType: row.page_type,
      languageCode: row.language_code,
      contentMarkdown: row.content_markdown,
      contentDigest: row.content_digest,
      listingFieldsHash: row.listing_fields_hash,
    },
    // The schema's check constraint writes these four columns together.
    assessment:
      row.assessment_source_hash === null
        ? null
        : {
            description: row.generated_description!,
            listingValue: row.listing_value!,
            exclusionReason: row.exclusion_reason,
            // An assessment from before scope was asked is not treated as narrow.
            scope: row.assessed_page_scope ?? 'broad',
            pageType: row.assessed_page_type!,
            sourceHash: row.assessment_source_hash,
          },
    fetchUrl: row.fetch_url,
    crawlSignals: {
      crawlDepth: row.crawl_depth,
      discoveredVia: row.discovered_via,
      hasNoindexDirective: row.has_noindex_directive,
      isInSiteNavigation: row.is_in_site_navigation,
      inboundLinkCount: row.inbound_link_count,
      navigationLabel: row.navigation_label,
      navigationPosition: row.navigation_position,
      firstLinkPosition: row.first_link_position,
    },
    markdownVariantUrl: row.markdown_variant_url,
  }));
}
