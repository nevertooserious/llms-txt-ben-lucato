import type { ReactNode } from 'react';

// Renders an llms.txt as the markdown it is, for the subset the spec uses: H1, H2,
// blockquote, link-list entries and paragraphs. The text comes from crawled pages, so
// it is untrusted: React escapes it, and only http(s) links are made clickable.

const ENTRY = /^- \[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)(?:: (.*))?$/;

export function LlmsTxtPreview({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let entries: ReactNode[] = [];
  const flushEntries = () => {
    if (entries.length > 0) blocks.push(<ul key={`list-${blocks.length}`}>{entries}</ul>);
    entries = [];
  };

  content.split('\n').forEach((line, index) => {
    const entry = ENTRY.exec(line);
    if (entry) {
      const [, title = '', url = '', description] = entry;
      entries.push(
        <li key={index}>
          {/^https?:\/\//i.test(url) ? (
            <a href={url} target="_blank" rel="noreferrer noopener nofollow">
              {title.replace(/\\(.)/g, '$1')}
            </a>
          ) : (
            title
          )}
          {description && <span className="entry-description">{description}</span>}
        </li>,
      );
      return;
    }
    flushEntries();
    if (line.startsWith('# ')) blocks.push(<h1 key={index}>{line.slice(2)}</h1>);
    else if (line.startsWith('## ')) blocks.push(<h2 key={index}>{line.slice(3)}</h2>);
    else if (line.startsWith('> ')) blocks.push(<blockquote key={index}>{line.slice(2)}</blockquote>);
    else if (line.trim() !== '') blocks.push(<p key={index}>{line}</p>);
  });
  flushEntries();

  return <article className="preview">{blocks}</article>;
}
