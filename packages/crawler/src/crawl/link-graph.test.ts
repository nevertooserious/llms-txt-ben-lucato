import { describe, expect, it } from 'vitest';
import { computeLinkGraphSignals } from './link-graph';

const ROOT = 'https://example.com';
const url = (path: string) => `${ROOT}${path}`;
const graph = (pages: Record<string, string[]>) =>
  new Map(Object.entries(pages).map(([page, links]) => [page === '/' ? ROOT : url(page), links.map(url)]));
const positionsOf = (signals: ReturnType<typeof computeLinkGraphSignals>) =>
  [...signals.entries()]
    .sort(([, a], [, b]) => a.firstLinkPosition! - b.firstLinkPosition!)
    .map(([page]) => page.slice(ROOT.length));

describe('computeLinkGraphSignals', () => {
  it('numbers links breadth-first, in the order they stand on each page', () => {
    const signals = computeLinkGraphSignals(
      ROOT,
      graph({ '/': ['/b', '/a'], '/b': ['/b/deep', '/a'], '/a': ['/a/deep'] }),
    );
    expect(positionsOf(signals)).toEqual(['/b', '/a', '/b/deep', '/a/deep']);
  });

  it('places a new link where the site puts it, keeping the others in order', () => {
    const signals = computeLinkGraphSignals(ROOT, graph({ '/': ['/install', '/upgrade', '/config', '/faq'] }));
    expect(positionsOf(signals)).toEqual(['/install', '/upgrade', '/config', '/faq']);
  });

  it('gives the same result whatever order the pages are supplied in', () => {
    const pages = { '/': ['/a', '/b'], '/a': ['/c'], '/b': ['/d'], '/orphan': ['/e'] };
    const reversed = Object.fromEntries(Object.entries(pages).reverse());
    expect(computeLinkGraphSignals(ROOT, graph(reversed))).toEqual(computeLinkGraphSignals(ROOT, graph(pages)));
  });

  it('walks pages the homepage does not lead to after those it does', () => {
    const signals = computeLinkGraphSignals(ROOT, graph({ '/orphan': ['/from-orphan'], '/': ['/a'] }));
    expect(positionsOf(signals)).toEqual(['/a', '/from-orphan']);
  });

  it('counts each linking page once and ignores self-links', () => {
    const signals = computeLinkGraphSignals(ROOT, graph({ '/': ['/a', '/a'], '/b': ['/a', '/b'], '/a': ['/a'] }));
    expect(signals.get(url('/a'))?.inboundLinkCount).toBe(2);
    expect(signals.has(url('/b'))).toBe(false);
  });

  it('counts links to a meta-refresh page toward its target, through chains and loops', () => {
    const redirects = new Map([
      [url('/old'), url('/older')],
      [url('/older'), url('/new')],
      [url('/loop'), url('/loop')],
    ]);
    const signals = computeLinkGraphSignals(ROOT, graph({ '/': ['/old', '/loop'], '/a': ['/new'] }), redirects);
    expect(signals.get(url('/new'))?.inboundLinkCount).toBe(2);
    expect(signals.has(url('/old'))).toBe(false);
    expect(signals.get(url('/loop'))?.inboundLinkCount).toBe(1);
  });
});
