export interface SelectionLimits {
  /** Most entries in one section. Pages beyond a limit are left out, not moved to Optional. */
  maxEntriesPerSection: number;
  /** Docs, API and Guides are what the file is for, so their sections are larger. */
  maxDocumentationEntriesPerSection: number;
  /** Blog posts are numerous and individually minor, so their section is smaller. */
  maxBlogEntries: number;
  /** Most entries outside Optional. */
  maxPrimaryEntries: number;
  /** Most entries under Optional. */
  maxOptionalEntries: number;
  /**
   * A page scoring less is left out, so a large site's file does not fill up to the
   * limits with pages hardly anything links. Documentation is exempt: it is what the
   * file is for, and a docs page is often linked from its index alone.
   */
  minimumScore: number;
  /** The highest-scoring pages listed whatever they score, so a small site lists all it has. */
  entriesListedWhateverTheirScore: number;
}

export const DEFAULT_SELECTION_LIMITS: SelectionLimits = {
  maxEntriesPerSection: 8,
  maxDocumentationEntriesPerSection: 15,
  maxBlogEntries: 3,
  maxPrimaryEntries: 40,
  maxOptionalEntries: 15,
  minimumScore: 3,
  entriesListedWhateverTheirScore: 10,
};
