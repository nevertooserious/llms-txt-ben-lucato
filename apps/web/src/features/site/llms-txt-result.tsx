import type { SiteView } from '@/shared/site-view';
import { LlmsTxtPreview } from './llms-txt-preview';

export function LlmsTxtResult({ view }: { view: SiteView }) {
  const version = view.publishedVersion;

  return (
    <>
      <header className="cell-header">
        <h2 className="cell-title">llms.txt</h2>
        {version && (
          <a href={view.hostedLlmsTxtPath} target="_blank" rel="noreferrer">
            Raw
          </a>
        )}
      </header>

      {version === null ? (
        <p className="empty-state">File contents will appear here.</p>
      ) : (
        <>
          <div className="meta-row meta-row-top">
            <span>Version {version.versionNumber}</span>
            <span className="published-details">
              <span>Published {new Date(version.createdAt).toLocaleString()}</span>
            </span>
            <span className={`badge ${version.validation.isValid ? 'badge-valid' : 'badge-invalid'}`}>
              {version.validation.isValid ? '✓ Valid per spec' : '✕ Spec problems'}
            </span>
          </div>
          <LlmsTxtPreview content={version.llmsTxtContent} />
          {!version.validation.isValid && (
            <ul className="problems">
              {version.validation.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
