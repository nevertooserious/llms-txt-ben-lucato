import { describe, expect, it } from 'vitest';
import { decidePublication, listedEntries } from './decide-publication';

const file = (...entries: string[]) => ['# Example', '', '> A site.', '', '## Docs', '', ...entries, ''].join('\n');

describe('decidePublication', () => {
  it('publishes nothing when the text is unchanged', () => {
    const content = file('- [Intro](https://example.com/intro): Start here');
    expect(decidePublication(content, content)).toEqual({ kind: 'unchanged' });
  });

  it('lists every entry as added on the first publish', () => {
    const decision = decidePublication(null, file('- [Intro](https://example.com/intro)'));
    expect(decision).toMatchObject({
      kind: 'publish',
      listedPageCount: 1,
      pageChanges: { added: ['https://example.com/intro'], removed: [], changed: [] },
    });
  });

  it('reports added, removed and changed entries by URL', () => {
    const before = file('- [Intro](https://example.com/intro): Old', '- [Gone](https://example.com/gone)');
    const after = file('- [Intro](https://example.com/intro): New', '- [API](https://example.com/api)');
    expect(decidePublication(before, after)).toMatchObject({
      kind: 'publish',
      pageChanges: {
        added: ['https://example.com/api'],
        removed: ['https://example.com/gone'],
        changed: ['https://example.com/intro'],
      },
    });
  });
});

describe('listedEntries', () => {
  it('reads escaped brackets in titles and ignores other lines', () => {
    const entries = listedEntries(file('- [Array\\[\\] guide](https://example.com/a%28b%29): Desc', 'Plain text'));
    expect([...entries.keys()]).toEqual(['https://example.com/a%28b%29']);
  });
});
