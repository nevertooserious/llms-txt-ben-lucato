import type { SiteView } from '@/shared/site-view';
import { LlmsTxtPreview } from './llms-txt-preview';

export function LlmsTxtResult({ view, siteHost }: { view: SiteView; siteHost: string }) {
  const version = view.publishedVersion;
  const hostedUrl = typeof window === 'undefined' ? view.hostedLlmsTxtPath : `${window.location.origin}${view.hostedLlmsTxtPath}`;

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
        <p className="empty-state">Nothing published yet. The file appears here when the first run finishes.</p>
      ) : (
        <>
          <div className="meta-row">
            <span>Version {version.versionNumber}</span>
            <span>Published {new Date(version.createdAt).toLocaleString()}</span>
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
          <div className="hosted-field">
            <span className="label">Hosted at</span>
            <code className="hosted-url">{hostedUrl}</code>
            <p className="hint">
              Redirect or proxy https://{siteHost}/llms.txt to this URL. It serves{' '}
              {view.isPublishedVersionPinned ? 'the version you pinned' : 'the latest version'}.
            </p>
          </div>
        </>
      )}
    </>
  );
}
