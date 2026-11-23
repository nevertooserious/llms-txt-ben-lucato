import { brotliDecompressSync, constants as zlib, gunzipSync, inflateSync } from 'node:zlib';

/**
 * Undoes the `Content-Encoding` of a body, which undici leaves as it is. Throws a
 * RangeError when the result is larger than `maxOutputLength`, and an Error for an
 * encoding it does not know. A body cut short at the size cap (`isTruncated`) gives
 * what it holds.
 */
export function decodeContentEncoding(
  bodyBytes: Buffer,
  contentEncoding: string | undefined,
  maxOutputLength: number,
  isTruncated = false,
): Buffer {
  // Encodings are listed in the order they were applied, so they are undone in reverse.
  const encodings = (contentEncoding ?? '')
    .split(',')
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding !== '' && encoding !== 'identity')
    .reverse();
  let decoded = bodyBytes;
  for (const encoding of encodings) {
    // Nothing to undo: a 304, an empty page.
    if (decoded.length === 0) return decoded;
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      decoded = gunzipSync(decoded, { maxOutputLength, ...(isTruncated ? { finishFlush: zlib.Z_SYNC_FLUSH } : {}) });
    } else if (encoding === 'deflate') {
      decoded = inflateSync(decoded, { maxOutputLength, ...(isTruncated ? { finishFlush: zlib.Z_SYNC_FLUSH } : {}) });
    } else if (encoding === 'br') {
      decoded = brotliDecompressSync(decoded, {
        maxOutputLength,
        ...(isTruncated ? { finishFlush: zlib.BROTLI_OPERATION_FLUSH } : {}),
      });
    } else {
      throw new Error(`content encoding ${encoding} is not supported`);
    }
  }
  return decoded;
}
