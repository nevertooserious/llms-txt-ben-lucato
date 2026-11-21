/** Thrown by `readCapped` when a body passes its limit. */
export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`body exceeds ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads a body stream into memory, destroying it as soon as it passes `maxBytes`. Throws
 * `ResponseTooLargeError` then, unless `truncate` is set, in which case it returns the
 * first `maxBytes`.
 */
export async function readCapped(
  body: AsyncIterable<Buffer> & { destroy(): void },
  maxBytes: number,
  { truncate = false } = {},
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      body.destroy();
      if (truncate) {
        chunks.push(chunk.subarray(0, chunk.length - (totalBytes - maxBytes)));
        return Buffer.concat(chunks);
      }
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
