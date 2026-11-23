// A line diff of two llms.txt versions, by longest common subsequence. The lines shared
// at the start and end are trimmed first, so the table covers only the changed middle.

export interface DiffLine {
  kind: 'unchanged' | 'added' | 'removed';
  text: string;
  /** Line number in the older text; null for an added line. */
  fromLineNumber: number | null;
  /** Line number in the newer text; null for a removed line. */
  toLineNumber: number | null;
}

export type DiffRow = { kind: 'line'; line: DiffLine } | { kind: 'skipped'; lineCount: number };

/** Above this many table cells, the changed middle is shown as replaced rather than aligned. */
const MAX_TABLE_CELLS = 16_000_000;

/** An empty text has no lines; a final newline ends the last line rather than starting another. */
const splitLines = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

export function diffLines(fromText: string, toText: string): DiffLine[] {
  const fromLines = splitLines(fromText);
  const toLines = splitLines(toText);

  const prefix = sharedLineCount(fromLines, toLines, 0, (index) => index);
  const suffix = sharedLineCount(fromLines, toLines, prefix, (index, lines) => lines.length - 1 - index);

  const fromCount = fromLines.length - prefix - suffix;
  const toCount = toLines.length - prefix - suffix;
  const width = toCount + 1;
  const canAlign = (fromCount + 1) * width <= MAX_TABLE_CELLS;
  const common = canAlign
    ? commonSubsequenceTable(fromLines.slice(prefix, prefix + fromCount), toLines.slice(prefix, prefix + toCount))
    : new Uint32Array(0);

  const result: DiffLine[] = [];
  const pushUnchanged = (fromIndex: number, toIndex: number) =>
    result.push({
      kind: 'unchanged',
      text: fromLines[fromIndex]!,
      fromLineNumber: fromIndex + 1,
      toLineNumber: toIndex + 1,
    });
  const pushRemoved = (fromIndex: number) =>
    result.push({ kind: 'removed', text: fromLines[fromIndex]!, fromLineNumber: fromIndex + 1, toLineNumber: null });
  const pushAdded = (toIndex: number) =>
    result.push({ kind: 'added', text: toLines[toIndex]!, fromLineNumber: null, toLineNumber: toIndex + 1 });

  for (let index = 0; index < prefix; index += 1) pushUnchanged(index, index);

  let i = 0;
  let j = 0;
  while (canAlign && i < fromCount && j < toCount) {
    if (fromLines[prefix + i] === toLines[prefix + j]) {
      pushUnchanged(prefix + i, prefix + j);
      i += 1;
      j += 1;
    } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) {
      pushRemoved(prefix + i);
      i += 1;
    } else {
      pushAdded(prefix + j);
      j += 1;
    }
  }
  for (; i < fromCount; i += 1) pushRemoved(prefix + i);
  for (; j < toCount; j += 1) pushAdded(prefix + j);

  for (let index = 0; index < suffix; index += 1) {
    pushUnchanged(fromLines.length - suffix + index, toLines.length - suffix + index);
  }
  return result;
}

/**
 * How many lines the two texts share, counted from one end: `lineAt` turns a count into
 * the index of the next line to compare. Stops `reserved` lines short of either text's
 * length, so a suffix does not overlap the prefix.
 */
function sharedLineCount(
  fromLines: readonly string[],
  toLines: readonly string[],
  reserved: number,
  lineAt: (index: number, lines: readonly string[]) => number,
): number {
  const limit = Math.min(fromLines.length, toLines.length) - reserved;
  let count = 0;
  while (count < limit && fromLines[lineAt(count, fromLines)] === toLines[lineAt(count, toLines)]) count += 1;
  return count;
}

/** table[i * (toLines.length + 1) + j]: the longest common subsequence of the lines from i and j on. */
function commonSubsequenceTable(fromLines: readonly string[], toLines: readonly string[]): Uint32Array {
  const width = toLines.length + 1;
  const table = new Uint32Array((fromLines.length + 1) * width);
  for (let i = fromLines.length - 1; i >= 0; i -= 1) {
    for (let j = toLines.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        fromLines[i] === toLines[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  return table;
}

/** Keeps `contextLineCount` unchanged lines around each change and folds the rest. */
export function collapseUnchangedLines(lines: DiffLine[], contextLineCount = 3): DiffRow[] {
  const isKept = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === 'unchanged') return;
    const end = Math.min(lines.length - 1, index + contextLineCount);
    for (let kept = Math.max(0, index - contextLineCount); kept <= end; kept += 1) isKept[kept] = true;
  });

  const rows: DiffRow[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (!isKept[index]) {
      skipped += 1;
      return;
    }
    if (skipped > 0) rows.push({ kind: 'skipped', lineCount: skipped });
    skipped = 0;
    rows.push({ kind: 'line', line });
  });
  if (skipped > 0) rows.push({ kind: 'skipped', lineCount: skipped });
  return rows;
}
