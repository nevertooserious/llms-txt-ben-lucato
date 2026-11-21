import { describe, expect, it } from 'vitest';
import { collapseUnchangedLines, diffLines, type DiffLine } from './diff-lines';

const marked = (lines: DiffLine[]) =>
  lines.map((line) => `${{ unchanged: ' ', added: '+', removed: '-' }[line.kind]}${line.text}`);

describe('diffLines', () => {
  it('reports identical texts as unchanged', () => {
    expect(marked(diffLines('a\nb\n', 'a\nb\n'))).toEqual([' a', ' b']);
  });

  it('shows a changed line as removed, then added, with each side numbered', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(marked(lines)).toEqual([' a', '-b', '+B', ' c']);
    expect(lines[1]).toMatchObject({ fromLineNumber: 2, toLineNumber: null });
    expect(lines[2]).toMatchObject({ fromLineNumber: null, toLineNumber: 2 });
    expect(lines[3]).toMatchObject({ fromLineNumber: 3, toLineNumber: 3 });
  });

  it('aligns on lines common to both sides of several changes', () => {
    expect(marked(diffLines('a\nb\nc\nd\ne', 'b\nc\nx\ne\nf'))).toEqual([
      '-a',
      ' b',
      ' c',
      '-d',
      '+x',
      ' e',
      '+f',
    ]);
  });

  it('handles repeated lines around an insertion', () => {
    expect(marked(diffLines('a\na', 'a\na\na'))).toEqual([' a', ' a', '+a']);
  });

  it('treats an empty text as having no lines', () => {
    expect(marked(diffLines('', 'a\nb\n'))).toEqual(['+a', '+b']);
    expect(marked(diffLines('a\n', ''))).toEqual(['-a']);
    expect(diffLines('', '')).toEqual([]);
    // A text that is one blank line still has that line.
    expect(marked(diffLines('\n', 'a\n'))).toEqual(['-', '+a']);
  });

  it('still shows every line when the texts are too large to align', () => {
    const from = Array.from({ length: 5000 }, (_, index) => `from ${index}`).join('\n');
    const to = Array.from({ length: 5000 }, (_, index) => `to ${index}`).join('\n');
    const lines = diffLines(from, to);
    expect(lines.filter((line) => line.kind === 'removed')).toHaveLength(5000);
    expect(lines.filter((line) => line.kind === 'added')).toHaveLength(5000);
  });
});

describe('collapseUnchangedLines', () => {
  it('folds unchanged lines away from a change and keeps its context', () => {
    const from = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
    const to = from.replace('5', 'five');
    const rows = collapseUnchangedLines(diffLines(from, to), 1);
    expect(rows.map((row) => (row.kind === 'skipped' ? row.lineCount : row.line.text))).toEqual([
      3,
      '4',
      '5',
      'five',
      '6',
      3,
    ]);
  });

  it('folds everything when nothing changed', () => {
    expect(collapseUnchangedLines(diffLines('a\nb', 'a\nb'))).toEqual([{ kind: 'skipped', lineCount: 2 }]);
  });
});
