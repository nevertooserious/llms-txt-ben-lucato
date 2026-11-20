import type { Cheerio, CheerioAPI } from 'cheerio/slim';
import type { Element } from 'domhandler';
import TurndownService from 'turndown';
import { resolveUrl } from './parse-html';

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

// Turndown has no table support; one line per row keeps cells together and readable.
turndownService.addRule('tableCell', {
  filter: ['th', 'td'],
  replacement: (content) => ` ${content.replace(/\s+/g, ' ').trim()} |`,
});
turndownService.addRule('tableRow', {
  filter: 'tr',
  replacement: (content) => `\n|${content}\n`,
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
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}
