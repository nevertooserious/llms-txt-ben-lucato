import { TextDecoder } from 'node:util';

// Decodes a response body to text. The charset comes from, in order: a byte order mark,
// the Content-Type header, a <meta> charset in the first 1024 bytes, then UTF-8. This is
// a simplified form of the HTML spec's encoding sniffing.

const META_SNIFF_BYTES = 1024;

export function decodeBody(bytes: Uint8Array, contentTypeHeader: string | undefined): string {
  const bomCharset = byteOrderMarkCharset(bytes);
  const candidates = [
    bomCharset,
    charsetFromContentType(contentTypeHeader),
    charsetFromMeta(bytes),
    'utf-8',
  ];
  for (const charset of candidates) {
    if (charset === null) continue;
    const decoder = tryDecoder(charset);
    // TextDecoder strips a matching BOM itself.
    if (decoder !== null) return decoder.decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function byteOrderMarkCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  return null;
}

function charsetFromContentType(contentTypeHeader: string | undefined): string | null {
  if (contentTypeHeader === undefined) return null;
  const match = /charset\s*=\s*"?([^";\s]+)/i.exec(contentTypeHeader);
  return match?.[1] ?? null;
}

function charsetFromMeta(bytes: Uint8Array): string | null {
  // ASCII-compatible encodings agree on these bytes, so latin1 is safe for the sniff.
  const head = Buffer.from(bytes.subarray(0, META_SNIFF_BYTES)).toString('latin1');
  const match =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(head);
  const charset = match?.[1] ?? null;
  // A document whose <meta> could be read as ASCII is not UTF-16, whatever it claims.
  return charset !== null && /^utf-16/i.test(charset) ? 'utf-8' : charset;
}

function tryDecoder(charset: string): TextDecoder | null {
  try {
    return new TextDecoder(charset.toLowerCase());
  } catch {
    return null;
  }
}
