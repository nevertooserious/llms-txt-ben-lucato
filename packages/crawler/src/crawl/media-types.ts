// The media types the crawl asks for.

export const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
export const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'];

export function isSuccessStatus(httpStatusCode: number): boolean {
  return httpStatusCode >= 200 && httpStatusCode < 300;
}
