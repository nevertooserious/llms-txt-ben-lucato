import { describe, expect, it } from 'vitest';
import { decodeBody } from './decode-body';

const latin1Html = (head: string) => Buffer.from(`<html><head>${head}</head><body>caf\xe9</body></html>`, 'latin1');

describe('decodeBody', () => {
  it('defaults to UTF-8', () => {
    expect(decodeBody(Buffer.from('<p>café</p>', 'utf8'), undefined)).toBe('<p>café</p>');
  });

  it('uses the Content-Type charset', () => {
    expect(decodeBody(latin1Html(''), 'text/html; charset=ISO-8859-1')).toContain('café');
  });

  it('uses a <meta charset> when the header has none', () => {
    expect(decodeBody(latin1Html('<meta charset="windows-1252">'), 'text/html')).toContain('café');
  });

  it('uses a <meta http-equiv> content charset', () => {
    const head = '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">';
    expect(decodeBody(latin1Html(head), undefined)).toContain('café');
  });

  it('prefers the header over the <meta>', () => {
    const bytes = Buffer.from('<meta charset="iso-8859-1"><p>café</p>', 'utf8');
    expect(decodeBody(bytes, 'text/html; charset=utf-8')).toContain('café');
  });

  it('prefers a byte order mark over everything', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<p>café</p>', 'utf8')]);
    expect(decodeBody(bytes, 'text/html; charset=iso-8859-1')).toBe('<p>café</p>');
  });

  it('falls back to UTF-8 for an unknown charset', () => {
    expect(decodeBody(Buffer.from('<p>café</p>', 'utf8'), 'text/html; charset=x-made-up')).toBe('<p>café</p>');
  });

  it('treats a <meta> claiming UTF-16 as UTF-8', () => {
    expect(decodeBody(Buffer.from('<meta charset="utf-16"><p>café</p>', 'utf8'), undefined)).toContain('café');
  });
});
