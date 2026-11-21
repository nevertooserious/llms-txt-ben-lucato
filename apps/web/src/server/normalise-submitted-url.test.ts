import { describe, expect, it } from 'vitest';
import { normaliseSubmittedUrl } from './normalise-submitted-url';

describe('normaliseSubmittedUrl', () => {
  it.each([
    ['https://Example.com/', 'https://example.com'],
    ['example.com', 'https://example.com'],
    ['http://example.com:80/docs/', 'http://example.com/docs'],
    ['https://example.com/docs?ref=nav#intro', 'https://example.com/docs'],
    ['  https://example.com:8443  ', 'https://example.com:8443'],
  ])('%s -> %s', (submitted, expected) => {
    expect(normaliseSubmittedUrl(submitted)).toBe(expected);
  });

  it.each(['', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'https://user:pass@example.com'])(
    'rejects %j',
    (submitted) => {
      expect(normaliseSubmittedUrl(submitted)).toBeNull();
    },
  );
});
