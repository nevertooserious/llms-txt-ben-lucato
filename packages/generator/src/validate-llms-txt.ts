export interface LlmsTxtValidationResult {
  isValid: boolean;
  problems: string[];
}

/**
 * Checks the rules in docs/design/README.md section 8: one H1 first, an optional
 * blockquote, only H1 and H2, and one-line `- [title](url): description` entries under
 * the H2s. A first version: it does not yet check the order of the parts before the
 * first H2.
 */
export function validateLlmsTxt(llmsTxt: string): LlmsTxtValidationResult {
  const problems: string[] = [];
  const lines = llmsTxt.split('\n');
  const firstContentLine = lines.find((line) => line.trim() !== '');
  if (firstContentLine === undefined || !/^# \S/.test(firstContentLine)) {
    problems.push('The file must start with an H1 naming the site.');
  }
  let isInSection = false;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^#{3,}\s/.test(line)) problems.push(`Line ${lineNumber}: only H1 and H2 headings are allowed.`);
    if (/^# /.test(line) && line !== firstContentLine) problems.push(`Line ${lineNumber}: there must be only one H1.`);
    if (/^## /.test(line)) {
      isInSection = true;
      return;
    }
    if (!isInSection || line.trim() === '') return;
    if (!/^- \[(?:\\.|[^\]\\])+\]\([^)\s]+\)(?:: .+)?$/.test(line)) {
      problems.push(`Line ${lineNumber}: an entry must be one line of the form "- [title](url): description".`);
    }
  });
  return { isValid: problems.length === 0, problems };
}
