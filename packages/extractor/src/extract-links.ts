import { NotImplementedError } from '@llms-txt/contracts';

/** Absolute URLs of every <a href> in the document, resolved against baseUrl. */
export function extractLinks(html: string, baseUrl: string): string[] {
  void html;
  void baseUrl;
  throw new NotImplementedError('extractLinks');
}
