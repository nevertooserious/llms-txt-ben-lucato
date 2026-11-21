'use client';

import { useEffect, useMemo, useState } from 'react';
import { collapseUnchangedLines, diffLines } from '@/shared/diff-lines';
import type { LlmsTxtVersionSummaryView } from '@/shared/site-view';
import { fetchVersionContent, fetchVersionSummaries, SiteApiError } from '@/browser/site-api';

const LINE_MARKERS = { unchanged: ' ', added: '+', removed: '−' } as const;

const errorMessage = (error: unknown) =>
  error instanceof SiteApiError ? error.message : 'Could not reach the server.';

export function VersionComparison({
  publicSlug,
  publishedVersionNumber,
  newestVersionNumber,
}: {
  publicSlug: string;
  publishedVersionNumber: number;
  /** Differs from the published version while an older one is pinned. */
  newestVersionNumber: number;
}) {
  const [versions, setVersions] = useState<LlmsTxtVersionSummaryView[] | null>(null);
  // Null until the user picks: the comparison then follows the two newest versions.
  const [chosenFromVersion, setChosenFromVersion] = useState<number | null>(null);
  const [chosenToVersion, setChosenToVersion] = useState<number | null>(null);
  // Versions never change once written, so a loaded text is kept for the session.
  const [contents, setContents] = useState<Record<number, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (newestVersionNumber < 2) return;
    let isCancelled = false;
    fetchVersionSummaries(publicSlug)
      .then((loaded) => {
        if (!isCancelled) setVersions(loaded);
      })
      .catch((error: unknown) => {
        if (!isCancelled) setLoadError(errorMessage(error));
      });
    return () => {
      isCancelled = true;
    };
  }, [publicSlug, newestVersionNumber]);

  const fromVersion = chosenFromVersion ?? versions?.[1]?.versionNumber ?? null;
  const toVersion = chosenToVersion ?? versions?.[0]?.versionNumber ?? null;
  const fromContent = fromVersion === null ? undefined : contents[fromVersion];
  const toContent = toVersion === null ? undefined : contents[toVersion];

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

  const diff = useMemo(() => {
    if (fromContent === undefined || toContent === undefined) return null;
    const lines = diffLines(fromContent, toContent);
    return {
      rows: collapseUnchangedLines(lines),
      addedCount: lines.filter((line) => line.kind === 'added').length,
      removedCount: lines.filter((line) => line.kind === 'removed').length,
    };
  }, [fromContent, toContent]);

  const versionSelect = (label: string, value: number | null, onChange: (versionNumber: number) => void) => (
    <label className="version-select">
      <span className="label">{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(Number(event.target.value))}>
        {versions?.map((version) => (
          <option key={version.versionNumber} value={version.versionNumber}>
            {`v${version.versionNumber} · ${version.listedPageCount} pages · ${new Date(version.createdAt).toLocaleString()}`}
            {version.versionNumber === publishedVersionNumber ? ' · live' : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">Compare versions</h2>
      </header>

      {newestVersionNumber < 2 ? (
        <p className="empty-state">There is one version so far. A new one appears here when the site changes.</p>
      ) : versions === null ? (
        loadError ? <p className="notice notice-danger">{loadError}</p> : <p className="hint">Loading versions…</p>
      ) : (
        <>
          <div className="version-controls">
            {versionSelect('From version', fromVersion, setChosenFromVersion)}
            {versionSelect('To version', toVersion, setChosenToVersion)}
          </div>

          {loadError && <p className="notice notice-danger">{loadError}</p>}
          {fromVersion === toVersion ? (
            <p className="empty-state">Pick two different versions to compare.</p>
          ) : diff === null ? (
            !loadError && <p className="hint">Loading comparison…</p>
          ) : diff.addedCount === 0 && diff.removedCount === 0 ? (
            <p className="empty-state">
              Versions {fromVersion} and {toVersion} have the same text.
            </p>
          ) : (
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
                    {diff.rows.map((row, index) =>
                      row.kind === 'skipped' ? (
                        <tr key={index} className="diff-skipped">
                          <td colSpan={4}>
                            ⋯ {row.lineCount} unchanged {row.lineCount === 1 ? 'line' : 'lines'}
                          </td>
                        </tr>
                      ) : (
                        <tr key={index} className={`diff-${row.line.kind}`}>
                          <td className="diff-number">{row.line.fromLineNumber}</td>
                          <td className="diff-number">{row.line.toLineNumber}</td>
                          <td className="diff-marker">{LINE_MARKERS[row.line.kind]}</td>
                          <td className="diff-text">{row.line.text}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
