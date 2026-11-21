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

const splitLines = (text: string) => text.replace(/\n$/, '').split('\n');

export function diffLines(fromText: string, toText: string): DiffLine[] {
  const fromLines = splitLines(fromText);
  const toLines = splitLines(toText);

  let prefix = 0;
  while (prefix < fromLines.length && prefix < toLines.length && fromLines[prefix] === toLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < fromLines.length - prefix &&
    suffix < toLines.length - prefix &&
    fromLines[fromLines.length - 1 - suffix] === toLines[toLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const fromCount = fromLines.length - prefix - suffix;
  const toCount = toLines.length - prefix - suffix;
  const width = toCount + 1;
  const canAlign = (fromCount + 1) * width <= MAX_TABLE_CELLS;

  // common[i * width + j]: the longest common subsequence of the middles from i and j on.
  const common = new Uint32Array(canAlign ? (fromCount + 1) * width : 0);
  if (canAlign) {
    for (let i = fromCount - 1; i >= 0; i -= 1) {
      for (let j = toCount - 1; j >= 0; j -= 1) {
        common[i * width + j] =
          fromLines[prefix + i] === toLines[prefix + j]
            ? common[(i + 1) * width + j + 1]! + 1
            : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
      }
    }
  }

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
