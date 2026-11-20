/** Thrown by `readCapped` when a body passes its limit. */
export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`body exceeds ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Reads a body stream into memory, destroying it as soon as it passes `maxBytes`. */
export async function readCapped(body: AsyncIterable<Buffer> & { destroy(): void }, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      body.destroy();
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
