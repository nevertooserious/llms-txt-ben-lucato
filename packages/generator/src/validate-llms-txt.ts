export interface LlmsTxtValidationResult {
  isValid: boolean;
  /** One line per problem, naming the line it was found on. */
  problems: string[];
}

/** `- [title](url)` with an optional `: description`. Brackets in the title are escaped; the URL has no spaces or `)`. */
export const ENTRY_PATTERN = /^- \[(?:\\.|[^\]\\])+\]\([^()\s]+\)(?:: \S.*)?$/;

const HEADING_PATTERN = /^(#{1,6})(?:\s+(.*))?$/;

/**
 * Checks the rules in docs/design/README.md section 8: one H1 first, an optional
 * blockquote, body text with no headings, then H2 sections that hold only one-line
 * `- [title](url): description` entries. No H3 or deeper. A section of skippable links
 * is named exactly `Optional`.
 */
export function validateLlmsTxt(llmsTxt: string): LlmsTxtValidationResult {
  const problems: string[] = [];
  const lines = llmsTxt.split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim() !== '');
  const sectionNames = new Set<string>();
  let isInSection = false;

  if (firstContentIndex === -1) return { isValid: false, problems: ['the file is empty'] };
  if (!/^# \S/.test(lines[firstContentIndex]!)) {
    problems.push(`line ${firstContentIndex + 1}: the file must start with an H1 naming the site`);
  }

  lines.forEach((line, index) => {
    if (index <= firstContentIndex || line.trim() === '') return;
    const at = `line ${index + 1}`;
    const heading = HEADING_PATTERN.exec(line);
    if (heading !== null) {
      const level = heading[1]!.length;
      const name = heading[2]?.trim() ?? '';
      if (level === 1) problems.push(`${at}: only one H1 is allowed`);
      else if (level > 2) problems.push(`${at}: only H1 and H2 headings are allowed`);
      else if (name === '') problems.push(`${at}: an H2 needs a name`);
      else {
        if (name !== 'Optional' && name.toLowerCase() === 'optional') {
          problems.push(`${at}: the skippable section must be named exactly "Optional"`);
        }
        if (sectionNames.has(name)) problems.push(`${at}: section "${name}" appears twice`);
        sectionNames.add(name);
        isInSection = true;
      }
      return;
    }
    if (isInSection && !ENTRY_PATTERN.test(line)) {
      problems.push(`${at}: a section may only hold one-line "- [title](url): description" entries`);
    }
  });

  return { isValid: problems.length === 0, problems };
}
