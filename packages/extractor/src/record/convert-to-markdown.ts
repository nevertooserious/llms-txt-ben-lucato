import type { Cheerio, CheerioAPI } from 'cheerio/slim';
import type { Element } from 'domhandler';
import TurndownService from 'turndown';
import { resolveUrl } from '../html/parse-html';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
  hr: '---',
});

// A link with no text renders as `[](url)`, which says nothing.
turndownService.addRule('dropEmptyLinks', {
  filter: (node) => node.nodeName === 'A' && (node.textContent ?? '').trim() === '',
  replacement: () => '',
});

// Turndown pads list markers to four columns ("-   item"); one space is the common style.
turndownService.addRule('listItem', {
  filter: 'li',
  replacement: (content, node, options) => {
    const list = node.parentNode;
    let marker = `${options.bulletListMarker} `;
    if (list && list.nodeName === 'OL') {
      const start = Number(list.getAttribute('start') ?? 1) || 1;
      marker = `${start + Array.prototype.indexOf.call(list.children, node)}. `;
    }
    const body = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '\n')
      .replace(/\n/g, `\n${' '.repeat(marker.length)}`);
    return `${marker}${body}${node.nextSibling && !body.endsWith('\n') ? '\n' : ''}`;
  },
});

// Turndown has no table support. Tables become GFM tables: one line per row, and the
// first row is the header, because GFM requires one even when the HTML has no <th>.
turndownService.addRule('tableCell', {
  filter: ['th', 'td'],
  replacement: (content) => ` ${content.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')} |`,
});
turndownService.addRule('tableRow', {
  filter: 'tr',
  replacement: (content) => `\n|${content}\n`,
});
turndownService.addRule('table', {
  filter: 'table',
  replacement: (content) => {
    // <thead> and <tbody> leave blank lines between rows; only row lines are kept.
    const rows = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('|'));
    const [headerRow, ...bodyRows] = rows;
    if (headerRow === undefined) return content;
    const cellCount = (headerRow.match(/(?<!\\)\|/g)?.length ?? 1) - 1;
    const separatorRow = `|${' --- |'.repeat(cellCount)}`;
    return `\n\n${[headerRow, separatorRow, ...bodyRows].join('\n')}\n\n`;
  },
});

/**
 * Converts the content element to markdown. Link targets are made absolute against
 * baseUrl first, so the markdown stands on its own. Mutates the element's links.
 */
export function convertToMarkdown($: CheerioAPI, content: Cheerio<Element>, baseUrl: string): string {
  content.find('a').each((_, element) => {
    const link = $(element);
    const href = link.attr('href');
    const absoluteHref = href === undefined ? null : resolveUrl(href, baseUrl);
    if (absoluteHref && /^https?:/.test(absoluteHref)) {
      link.attr('href', absoluteHref);
    } else {
      // javascript:, mailto: and missing targets keep their text but lose the link.
      link.replaceWith(link.contents());
    }
  });

  const markdown = turndownService.turndown(content.html() ?? '');
  // Non-breaking spaces (&nbsp;) are layout, not meaning; plain spaces read the same.
  return markdown.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
