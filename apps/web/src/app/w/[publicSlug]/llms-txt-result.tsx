'use client';

import { useState } from 'react';
import type { WorkspaceView } from '../../../shared/workspace-view';
import { LlmsTxtPreview } from './llms-txt-preview';

export function LlmsTxtResult({ view, siteHost }: { view: WorkspaceView; siteHost: string }) {
  const [copied, setCopied] = useState<'text' | 'url' | null>(null);
  const version = view.publishedVersion;
  const hostedUrl = typeof window === 'undefined' ? view.hostedLlmsTxtPath : `${window.location.origin}${view.hostedLlmsTxtPath}`;

  async function copy(text: string, what: 'text' | 'url') {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  function download(content: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    link.download = 'llms.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">
          <span className="index">03</span>llms.txt
        </h2>
        {version && (
          <div className="toolbar">
            <button type="button" className="button" onClick={() => copy(version.llmsTxtContent, 'text')}>
              {copied === 'text' ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="button" onClick={() => download(version.llmsTxtContent)}>
              Download
            </button>
          </div>
        )}
      </header>

      {version === null ? (
        <p className="empty-state">Nothing published yet. The file appears here when the first run finishes.</p>
      ) : (
        <>
          <div className="meta-row">
            <span>Version {version.versionNumber}</span>
            <span>{version.listedPageCount} pages listed</span>
            <span>Published {new Date(version.createdAt).toLocaleString()}</span>
            <span className={`badge ${version.validation.isValid ? 'badge-valid' : 'badge-invalid'}`}>
              {version.validation.isValid ? '✓ Valid per spec' : '✕ Spec problems'}
            </span>
          </div>
          <div className="result-panes">
            <section aria-label="Rendered preview">
              <h3 className="label">Preview</h3>
              <LlmsTxtPreview content={version.llmsTxtContent} />
            </section>
            <section aria-label="Raw text">
              <h3 className="label">Raw</h3>
              <pre className="raw-text">{version.llmsTxtContent}</pre>
            </section>
          </div>
          {!version.validation.isValid && (
            <ul className="problems">
              {version.validation.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <div className="field" style={{ marginTop: 24 }}>
            <span className="label">Hosted at</span>
            <div className="copy-field">
              <code>{hostedUrl}</code>
              <a className="button" href={view.hostedLlmsTxtPath} target="_blank" rel="noreferrer">
                Open
              </a>
              <button type="button" className="button" onClick={() => copy(hostedUrl, 'url')}>
                {copied === 'url' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="hint">
              Redirect or proxy https://{siteHost}/llms.txt to this URL. It always serves the latest version.
            </p>
          </div>
        </>
      )}
    </>
  );
}
