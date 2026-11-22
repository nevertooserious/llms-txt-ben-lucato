'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  canBeIncluded,
  excludedPathOver,
  isExcludedByUser,
  isIncluded,
  pathGroupState,
  withPageIncluded,
  withPathExcluded,
  withPathToggled,
  type PageChoices,
} from './page-choices';

/** A top-level group with more pages than this starts closed, so a large site opens as a list of its areas. */
const MAX_PAGES_IN_GROUP_OPEN_AT_FIRST = 12;

interface PagesPanelProps {
  view: SiteView;
  onChanged: () => Promise<void>;
}

/**
 * The site's crawled pages, grouped by path. A ticked page is an entry of the file: the
 * generator's choice to begin with, which the user changes by ticking and unticking.
 * Unticking a path leaves out everything under it, including pages a later crawl finds.
 * Changes are collected and saved together, so one save is one new version.
 */
export function PagesPanel({ view, onChanged }: PagesPanelProps) {
  const [loaded, setLoaded] = useState<SitePagesView | null>(null);
  /** The choices as edited; null while they are as saved. */
  const [draft, setDraft] = useState<PageChoices | null>(null);
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
  const saved = useMemo<PageChoices>(
    () => ({
      excludedUrls: new Set(pages.filter((page) => page.isExcluded).map((page) => page.normalisedUrl)),
      excludedUrlPrefixes: new Set(loaded?.excludedUrlPrefixes ?? []),
      keptUrls: new Set(pages.filter((page) => page.isKept).map((page) => page.normalisedUrl)),
    }),
    [pages, loaded],
  );
  const current = draft ?? saved;
  const tree = useMemo(() => groupPagesByPath(pages, rootUrl), [pages, rootUrl]);
  const unsavedChangeCount =
    differenceCount(saved.excludedUrls, current.excludedUrls) +
    differenceCount(saved.excludedUrlPrefixes, current.excludedUrlPrefixes) +
    differenceCount(saved.keptUrls, current.keptUrls);

  function edit(next: PageChoices) {
    setDraft(next);
    setSavedMessage(null);
  }

  async function save() {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const result = await savePageExclusions(publicSlug, {
        excludedUrls: [...current.excludedUrls],
        excludedUrlPrefixes: [...current.excludedUrlPrefixes],
        keptUrls: [...current.keptUrls],
      });
      await Promise.all([load(), onChanged()]);
      setDraft(null);
      setSavedMessage(savedMessageFor(result));
    } catch (error) {
      setErrorMessage(error instanceof SiteApiError ? error.message : 'The changes could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  const listedCount = pages.filter((page) => page.listedInSection !== null).length;
  const excludedCount = pages.filter((page) => !page.isHomepage && page.listedInSection === null).length;
  const groupUrlPrefixes = useMemo(() => new Set(groupUrlPrefixesOf(tree)), [tree]);
  const treeProps = { saved, current, groupUrlPrefixes, onEdit: edit };
  return (
    <details className="pages-panel">
      <summary className="pages-panel-summary">
        <h2 className="cell-title">Pages</h2>
        <span className="pages-panel-counts">
          {loaded === null ? 'Loading…' : `${pages.length} crawled · ${listedCount} listed · ${excludedCount} excluded`}
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
      <p className="hint">
        A ticked page is listed in your llms.txt. Tick or untick pages to change that; unticking a path also leaves out pages
        found under it later.
      </p>
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

/** The URL prefix of every group in the tree, at any depth. */
function groupUrlPrefixesOf(items: readonly PathTreeItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'group' ? [item.urlPrefix, ...groupUrlPrefixesOf(item.items)] : []));
}

interface TreeProps {
  depth: number;
  saved: PageChoices;
  current: PageChoices;
  /** The paths that have a row of their own in the tree, where an excluded one is included again. */
  groupUrlPrefixes: ReadonlySet<string>;
  onEdit: (next: PageChoices) => void;
}

function PathTreeNode({ item, ...props }: TreeProps & { item: PathTreeItem }) {
  if (item.kind === 'group') return <PathGroup group={item} {...props} />;
  const { page, label } = item;
  const { saved, current } = props;
  const excludedPath = page.isHomepage ? null : excludedPathOver(page.normalisedUrl, current);
  // An excluded path can lose its row, when all but one of its pages go. Its last page then includes it again.
  const isOnlyRowOfExcludedPath = excludedPath !== null && !props.groupUrlPrefixes.has(excludedPath);
  const isPageIncluded = isIncluded(page, current);
  const isChanged = isPageIncluded !== isIncluded(page, saved);
  const isLocked = page.isHomepage || !canBeIncluded(page) || (excludedPath !== null && !isOnlyRowOfExcludedPath);
  return (
    <li className={`page-row${isPageIncluded || page.isHomepage ? '' : ' is-excluded'}${isChanged ? ' is-changed' : ''}`}>
      <label className="page-row-label">
        <input
          type="checkbox"
          checked={isPageIncluded || page.isHomepage}
          disabled={isLocked}
          onChange={(event) =>
            props.onEdit(
              isOnlyRowOfExcludedPath
                ? withPathExcluded(current, excludedPath, false)
                : withPageIncluded(current, page, event.target.checked),
            )
          }
        />
        <span className="page-path">{label}</span>
      </label>
      <span className="page-title">{page.title}</span>
      <PageStatus page={page} current={current} isChanged={isChanged} />
      <a className="page-open" href={page.normalisedUrl} target="_blank" rel="noreferrer noopener" aria-label={`Open ${label}`}>
        ↗
      </a>
    </li>
  );
}

function PathGroup({ group, depth, ...props }: TreeProps & { group: PathTreeGroup }) {
  const { saved, current } = props;
  const state = pathGroupState(group, current);
  const isPathExcluded = state === 'path_excluded' || state === 'under_excluded_path';
  const excludedPageCount = group.pages.filter((page) => !page.isHomepage && !isIncluded(page, current)).length;
  const isChanged = state !== pathGroupState(group, saved);
  return (
    <li className="page-group">
      <details open={depth > 0 || group.pages.length <= MAX_PAGES_IN_GROUP_OPEN_AT_FIRST}>
        <summary className={`page-group-summary${isChanged ? ' is-changed' : ''}`}>
          <input
            type="checkbox"
            aria-label={`Include the path ${group.label}`}
            checked={state === 'all_included'}
            disabled={state === 'under_excluded_path'}
            ref={(input) => {
              if (input) input.indeterminate = state === 'some_included';
            }}
            onChange={() => props.onEdit(withPathToggled(current, group))}
          />
          <span className="page-path">{group.label}</span>
          <span className="page-group-counts">
            {group.pages.length} pages
            {isPathExcluded ? ' · path excluded' : excludedPageCount > 0 && ` · ${excludedPageCount} excluded`}
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
  current: PageChoices;
  /** Ticked or unticked since the last save. */
  isChanged: boolean;
}

function PageStatus({ page, current, isChanged }: PageStatusProps) {
  if (page.isHomepage) return <span className="badge badge-quiet">Homepage</span>;
  if (isIncluded(page, current)) {
    // Ticked and not saved yet: the section is the generator's call on save.
    if (isChanged || page.listedInSection === null) return <span className="badge badge-quiet">Included on save</span>;
    return <span className="badge badge-valid">{page.listedInSection}</span>;
  }
  if (excludedPathOver(page.normalisedUrl, current) !== null) return <span className="badge badge-excluded">Path excluded</span>;
  if (isExcludedByUser(page, current)) return <span className="badge badge-excluded">Excluded by you</span>;
  if (!canBeIncluded(page)) return <span className="badge badge-quiet">Cannot be listed</span>;
  return <span className="badge badge-quiet">Excluded</span>;
}
