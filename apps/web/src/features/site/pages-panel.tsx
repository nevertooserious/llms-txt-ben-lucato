'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isUrlUnderPrefix } from '@llms-txt/contracts';
import {
  groupPagesByPath,
  type PathTreeGroup,
  type PathTreeItem,
  type SaveExclusionsResult,
  type SitePagesView,
  type SitePageView,
} from '@/shared/site-pages';
import type { SiteView } from '@/shared/site-view';
import { fetchSitePages, savePageExclusions, SiteApiError } from '@/browser/site-api';

/** A top-level group with more pages than this starts closed, so a large site opens as a list of its areas. */
const MAX_PAGES_IN_GROUP_OPEN_AT_FIRST = 12;

/** What the user ignores: pages one by one, and whole paths as URL prefixes. */
interface Exclusions {
  urls: ReadonlySet<string>;
  urlPrefixes: ReadonlySet<string>;
  /** Pages listed even if the generator would leave them out. */
  keptUrls: ReadonlySet<string>;
}

interface PagesPanelProps {
  view: SiteView;
  onChanged: () => Promise<void>;
}

/**
 * The site's crawled pages, grouped by path. Unticking a page ignores that page;
 * unticking a path ignores everything under it, including pages a later crawl finds.
 * Changes are collected and saved together, so one save is one new version.
 */
export function PagesPanel({ view, onChanged }: PagesPanelProps) {
  const [loaded, setLoaded] = useState<SitePagesView | null>(null);
  /** The exclusions as edited; null while they are as saved. */
  const [draft, setDraft] = useState<Exclusions | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const { publicSlug, rootUrl } = view;
  const load = useCallback(async () => {
    try {
      setLoaded(await fetchSitePages(publicSlug));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof SiteApiError ? error.message : 'The pages could not be loaded.');
    }
  }, [publicSlug]);

  // A finished run or a new version changes which pages exist and where they are listed.
  const newestVersionNumber = view.versions[0]?.versionNumber ?? null;
  const latestRunStatus = view.latestRun?.status ?? null;
  useEffect(() => {
    void load();
  }, [load, newestVersionNumber, latestRunStatus]);

  const pages = useMemo(() => loaded?.pages ?? [], [loaded]);
  const saved = useMemo<Exclusions>(
    () => ({
      urls: new Set(pages.filter((page) => page.isExcluded).map((page) => page.normalisedUrl)),
      urlPrefixes: new Set(loaded?.excludedUrlPrefixes ?? []),
      keptUrls: new Set(pages.filter((page) => page.isKept).map((page) => page.normalisedUrl)),
    }),
    [pages, loaded],
  );
  const current = draft ?? saved;
  const tree = useMemo(() => groupPagesByPath(pages, rootUrl), [pages, rootUrl]);
  const unsavedChangeCount =
    differenceCount(saved.urls, current.urls) +
    differenceCount(saved.urlPrefixes, current.urlPrefixes) +
    differenceCount(saved.keptUrls, current.keptUrls);

  function edit(change: (exclusions: { urls: Set<string>; urlPrefixes: Set<string>; keptUrls: Set<string> }) => void) {
    const next = { urls: new Set(current.urls), urlPrefixes: new Set(current.urlPrefixes), keptUrls: new Set(current.keptUrls) };
    change(next);
    setDraft(next);
    setSavedMessage(null);
  }
  const setPageIgnored = (page: SitePageView, isIgnored: boolean) =>
    edit(({ urls }) => (isIgnored ? urls.add(page.normalisedUrl) : urls.delete(page.normalisedUrl)));
  const setPathIgnored = (urlPrefix: string, isIgnored: boolean) =>
    edit(({ urlPrefixes }) => (isIgnored ? urlPrefixes.add(urlPrefix) : urlPrefixes.delete(urlPrefix)));

  const setPageKept = (page: SitePageView, isKept: boolean) =>
    edit(({ keptUrls }) => (isKept ? keptUrls.add(page.normalisedUrl) : keptUrls.delete(page.normalisedUrl)));

  async function save() {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const result = await savePageExclusions(publicSlug, {
        excludedUrls: [...current.urls],
        excludedUrlPrefixes: [...current.urlPrefixes],
        keptUrls: [...current.keptUrls],
      });
      await Promise.all([load(), onChanged()]);
      setDraft(null);
      setSavedMessage(savedMessageFor(result));
    } catch (error) {
      setErrorMessage(error instanceof SiteApiError ? error.message : 'The ignored pages could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  const listedCount = pages.filter((page) => page.listedInSection !== null).length;
  const ignoredCount = pages.filter((page) => isIgnored(page, saved)).length;
  const groupUrlPrefixes = useMemo(() => new Set(groupUrlPrefixesOf(tree)), [tree]);
  const treeProps = { saved, current, groupUrlPrefixes, onSetPageIgnored: setPageIgnored, onSetPathIgnored: setPathIgnored, onSetPageKept: setPageKept };
  return (
    <details className="pages-panel">
      <summary className="pages-panel-summary">
        <h2 className="cell-title">Pages</h2>
        <span className="pages-panel-counts">
          {loaded === null ? 'Loading…' : `${pages.length} crawled · ${listedCount} listed · ${ignoredCount} ignored`}
        </span>
        {/* In the summary so they stay in reach with the tree scrolled; a button does not toggle the section. */}
        {(unsavedChangeCount > 0 || savedMessage) && (
          <span className="pages-panel-actions" role="status">
            {unsavedChangeCount > 0 ? (
              <>
                <span>
                  {unsavedChangeCount} unsaved {unsavedChangeCount === 1 ? 'change' : 'changes'}
                </span>
                <button type="button" className="button" disabled={isSaving} onClick={() => setDraft(null)}>
                  Discard
                </button>
                <button type="button" className="button" disabled={isSaving} onClick={save}>
                  {isSaving ? 'Saving…' : 'Save and regenerate'}
                </button>
              </>
            ) : (
              <span>{savedMessage}</span>
            )}
          </span>
        )}
      </summary>
      <p className="hint">Untick a page(s) to tune what is included in your llms.txt.</p>
      {errorMessage && (
        <p className="form-error" role="status">
          {errorMessage}
        </p>
      )}
      {loaded !== null && pages.length === 0 && <p className="empty-state">No pages yet. They appear once the first crawl has run.</p>}
      {tree.length > 0 && (
        <ul className="page-tree">
          {tree.map((item) => (
            <PathTreeNode key={item.label} item={item} depth={0} {...treeProps} />
          ))}
        </ul>
      )}
    </details>
  );
}

function savedMessageFor(result: SaveExclusionsResult): string {
  switch (result.kind) {
    case 'published':
      return result.isLive
        ? `Saved. v${result.versionNumber} is live.`
        : `Saved as v${result.versionNumber}. Another version is pinned, so it is not live.`;
    case 'unchanged':
      return 'Saved. The file reads the same, so no new version was made.';
    case 'applied_by_next_run':
      return 'Saved. The next run applies it.';
  }
}

/** How many values are in one set and not the other. */
function differenceCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  return [...a].filter((value) => !b.has(value)).length + [...b].filter((value) => !a.has(value)).length;
}

/** The ignored path a URL is at or under, if any. */
function ignoredPathOver(url: string, exclusions: Exclusions): string | null {
  for (const urlPrefix of exclusions.urlPrefixes) {
    if (isUrlUnderPrefix(url, urlPrefix)) return urlPrefix;
  }
  return null;
}

/** The URL prefix of every group in the tree, at any depth. */
function groupUrlPrefixesOf(items: readonly PathTreeItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'group' ? [item.urlPrefix, ...groupUrlPrefixesOf(item.items)] : []));
}

function isIgnored(page: SitePageView, exclusions: Exclusions): boolean {
  return !page.isHomepage && (exclusions.urls.has(page.normalisedUrl) || ignoredPathOver(page.normalisedUrl, exclusions) !== null);
}

interface TreeProps {
  depth: number;
  saved: Exclusions;
  current: Exclusions;
  /** The paths that have a row of their own in the tree, where an ignored one is included again. */
  groupUrlPrefixes: ReadonlySet<string>;
  onSetPageIgnored: (page: SitePageView, isIgnored: boolean) => void;
  onSetPathIgnored: (urlPrefix: string, isIgnored: boolean) => void;
  onSetPageKept: (page: SitePageView, isKept: boolean) => void;
}

function PathTreeNode({ item, ...props }: TreeProps & { item: PathTreeItem }) {
  if (item.kind === 'group') return <PathGroup group={item} {...props} />;
  const { page, label } = item;
  const { saved, current } = props;
  const ignoredPath = page.isHomepage ? null : ignoredPathOver(page.normalisedUrl, current);
  const isUnderIgnoredPath = ignoredPath !== null;
  // An ignored path can lose its row, when all but one of its pages go. Its last page then includes it again.
  const isOnlyRowOfIgnoredPath = ignoredPath !== null && !props.groupUrlPrefixes.has(ignoredPath);
  const isPageIgnored = isIgnored(page, current);
  const isKept = current.keptUrls.has(page.normalisedUrl);
  const isChanged = isPageIgnored !== isIgnored(page, saved) || isKept !== saved.keptUrls.has(page.normalisedUrl);
  // Offered on a page the generator left out, and on one the user already keeps.
  const showsKeepButton = !isPageIgnored && page.canBeKept && (isKept || page.listedInSection === null);
  return (
    <li className={`page-row${isPageIgnored ? ' is-ignored' : ''}${isChanged ? ' is-changed' : ''}`}>
      <label className="page-row-label">
        <input
          type="checkbox"
          checked={!isPageIgnored}
          disabled={page.isHomepage || (isUnderIgnoredPath && !isOnlyRowOfIgnoredPath)}
          onChange={(event) =>
            isOnlyRowOfIgnoredPath ? props.onSetPathIgnored(ignoredPath, false) : props.onSetPageIgnored(page, !event.target.checked)
          }
        />
        <span className="page-path">{label}</span>
      </label>
      <span className="page-title">{page.title}</span>
      <PageStatus page={page} isPageIgnored={isPageIgnored} isUnderIgnoredPath={isUnderIgnoredPath} wasIgnored={isIgnored(page, saved)} />
      {showsKeepButton && (
        <button type="button" className="button" aria-pressed={isKept} onClick={() => props.onSetPageKept(page, !isKept)}>
          {isKept ? 'Kept' : 'Keep'}
        </button>
      )}
      <a className="page-open" href={page.normalisedUrl} target="_blank" rel="noreferrer noopener" aria-label={`Open ${label}`}>
        ↗
      </a>
    </li>
  );
}

function PathGroup({ group, depth, ...props }: TreeProps & { group: PathTreeGroup }) {
  const { saved, current } = props;
  const isPathIgnored = current.urlPrefixes.has(group.urlPrefix);
  // A path above this one is ignored, which covers this one: that is where to change it.
  const isUnderIgnoredPath = !isPathIgnored && ignoredPathOver(group.urlPrefix, current) !== null;
  const ignoredPageCount = group.pages.filter((page) => isIgnored(page, current)).length;
  const isChanged = isPathIgnored !== saved.urlPrefixes.has(group.urlPrefix);
  return (
    <li className="page-group">
      <details open={depth > 0 || group.pages.length <= MAX_PAGES_IN_GROUP_OPEN_AT_FIRST}>
        <summary className={`page-group-summary${isChanged ? ' is-changed' : ''}`}>
          <input
            type="checkbox"
            aria-label={`Include the path ${group.label}`}
            checked={!isPathIgnored && !isUnderIgnoredPath}
            disabled={isUnderIgnoredPath}
            ref={(input) => {
              if (input) input.indeterminate = !isPathIgnored && !isUnderIgnoredPath && ignoredPageCount > 0;
            }}
            onChange={() => props.onSetPathIgnored(group.urlPrefix, !isPathIgnored)}
          />
          <span className="page-path">{group.label}</span>
          <span className="page-group-counts">
            {group.pages.length} pages
            {isPathIgnored || isUnderIgnoredPath ? ' · path ignored' : ignoredPageCount > 0 && ` · ${ignoredPageCount} ignored`}
          </span>
        </summary>
        <ul className="page-tree">
          {group.items.map((child) => (
            <PathTreeNode key={child.label} item={child} depth={depth + 1} {...props} />
          ))}
        </ul>
      </details>
    </li>
  );
}

interface PageStatusProps {
  page: SitePageView;
  isPageIgnored: boolean;
  isUnderIgnoredPath: boolean;
  wasIgnored: boolean;
}

function PageStatus({ page, isPageIgnored, isUnderIgnoredPath, wasIgnored }: PageStatusProps) {
  if (page.isHomepage) return <span className="badge badge-quiet">Homepage</span>;
  if (isPageIgnored) return <span className="badge badge-ignored">{isUnderIgnoredPath ? 'Path ignored' : 'Ignored'}</span>;
  if (page.listedInSection !== null) return <span className="badge badge-valid">{page.listedInSection}</span>;
  // Included again and not saved yet: whether it is listed is the generator's call on save.
  if (wasIgnored) return <span className="badge badge-quiet">Included on save</span>;
  return <span className="badge badge-quiet">Not listed</span>;
}
