'use client';

import { useEffect, useMemo, useState } from 'react';
import { collapseUnchangedLines, diffLines, type DiffRow } from '@/shared/diff-lines';
import type { LlmsTxtVersionSummaryView } from '@/shared/site-view';
import { fetchVersionContent, SiteApiError } from '@/browser/site-api';

const LINE_MARKERS = { unchanged: ' ', added: '+', removed: '−' } as const;

const errorMessage = (error: unknown) =>
  error instanceof SiteApiError ? error.message : 'Could not reach the server.';

interface VersionComparisonProps {
  publicSlug: string;
  /** Newest first. */
  versions: LlmsTxtVersionSummaryView[];
  /** Not the newest version while an older one is pinned. */
  publishedVersionNumber: number;
}

export function VersionComparison({ publicSlug, versions, publishedVersionNumber }: VersionComparisonProps) {
  // Null until the user picks: the comparison then follows the two newest versions.
  const [chosenFromVersion, setChosenFromVersion] = useState<number | null>(null);
  const [chosenToVersion, setChosenToVersion] = useState<number | null>(null);
  const fromVersion = chosenFromVersion ?? versions[1]?.versionNumber ?? null;
  const toVersion = chosenToVersion ?? versions[0]?.versionNumber ?? null;
  const { fromContent, toContent, loadError } = useVersionContents(publicSlug, fromVersion, toVersion);

  const diff = useMemo(() => {
    if (fromContent === undefined || toContent === undefined) return null;
    const lines = diffLines(fromContent, toContent);
    return {
      rows: collapseUnchangedLines(lines),
      addedCount: lines.filter((line) => line.kind === 'added').length,
      removedCount: lines.filter((line) => line.kind === 'removed').length,
    };
  }, [fromContent, toContent]);

  const selectProps = { versions, publishedVersionNumber };
  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">Compare versions</h2>
      </header>

      {versions.length < 2 ? (
        <p className="empty-state">Comparison is available once more than a single version is available.</p>
      ) : (
        <>
          <div className="version-controls">
            <VersionSelect label="From version" value={fromVersion} onChange={setChosenFromVersion} {...selectProps} />
            <VersionSelect label="To version" value={toVersion} onChange={setChosenToVersion} {...selectProps} />
          </div>

          {loadError && <p className="notice notice-danger">{loadError}</p>}
          <ComparisonResult fromVersion={fromVersion} toVersion={toVersion} diff={diff} hasLoadError={loadError !== null} />
        </>
      )}
    </>
  );
}

/** The texts of the two versions, loaded as they are chosen; undefined until loaded. */
function useVersionContents(publicSlug: string, fromVersion: number | null, toVersion: number | null) {
  // Versions never change once written, so a loaded text is kept for the session.
  const [contents, setContents] = useState<Record<number, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (fromVersion === null || toVersion === null) return;
    const missing = [...new Set([fromVersion, toVersion])].filter((number) => contents[number] === undefined);
    if (missing.length === 0) return;
    let isCancelled = false;
    setLoadError(null);
    Promise.all(missing.map((number) => fetchVersionContent(publicSlug, number)))
      .then((loaded) => {
        if (isCancelled) return;
        setContents((current) => ({
          ...current,
          ...Object.fromEntries(loaded.map((version) => [version.versionNumber, version.llmsTxtContent])),
        }));
      })
      .catch((error: unknown) => {
        if (!isCancelled) setLoadError(errorMessage(error));
      });
    return () => {
      isCancelled = true;
    };
  }, [publicSlug, fromVersion, toVersion, contents]);

  return {
    fromContent: fromVersion === null ? undefined : contents[fromVersion],
    toContent: toVersion === null ? undefined : contents[toVersion],
    loadError,
  };
}

interface VersionSelectProps {
  label: string;
  value: number | null;
  onChange: (versionNumber: number) => void;
  versions: LlmsTxtVersionSummaryView[];
  publishedVersionNumber: number;
}

function VersionSelect({ label, value, onChange, versions, publishedVersionNumber }: VersionSelectProps) {
  return (
    <label className="version-select">
      <span className="label">{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(Number(event.target.value))}>
        {versions.map((version) => (
          <option key={version.versionNumber} value={version.versionNumber}>
            {`v${version.versionNumber} · ${version.listedPageCount} pages · ${new Date(version.createdAt).toLocaleString()}`}
            {version.versionNumber === publishedVersionNumber ? ' · live' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

interface VersionDiff {
  rows: DiffRow[];
  addedCount: number;
  removedCount: number;
}

interface ComparisonResultProps {
  fromVersion: number | null;
  toVersion: number | null;
  /** Null until both texts are loaded. */
  diff: VersionDiff | null;
  hasLoadError: boolean;
}

function ComparisonResult({ fromVersion, toVersion, diff, hasLoadError }: ComparisonResultProps) {
  if (fromVersion === toVersion) return <p className="empty-state">Pick two different versions to compare.</p>;
  if (diff === null) return hasLoadError ? null : <p className="hint">Loading comparison…</p>;
  if (diff.addedCount === 0 && diff.removedCount === 0) {
    return (
      <p className="empty-state">
        Versions {fromVersion} and {toVersion} have the same text.
      </p>
    );
  }
  return (
    <>
      <div className="meta-row" role="status">
        <span className="diff-count-added">+{diff.addedCount} added</span>
        <span className="diff-count-removed">−{diff.removedCount} removed</span>
      </div>
      <div className="diff-view">
        <table>
          <caption className="visually-hidden">
            Line changes from version {fromVersion} to version {toVersion}
          </caption>
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Line in version {fromVersion}</th>
              <th scope="col">Line in version {toVersion}</th>
              <th scope="col">Change</th>
              <th scope="col">Text</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row, index) => (
              <DiffTableRow key={index} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DiffTableRow({ row }: { row: DiffRow }) {
  if (row.kind === 'skipped') {
    return (
      <tr className="diff-skipped">
        <td colSpan={4}>
          ⋯ {row.lineCount} unchanged {row.lineCount === 1 ? 'line' : 'lines'}
        </td>
      </tr>
    );
  }
  return (
    <tr className={`diff-${row.line.kind}`}>
      <td className="diff-number">{row.line.fromLineNumber}</td>
      <td className="diff-number">{row.line.toLineNumber}</td>
      <td className="diff-marker">{LINE_MARKERS[row.line.kind]}</td>
      <td className="diff-text">{row.line.text}</td>
    </tr>
  );
}
