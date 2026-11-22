import { load } from 'cheerio/slim';


/** Headers the vendors set only on a response they challenged. */
const CHALLENGE_HEADERS: Array<[name: string, value: RegExp]> = [
  ['cf-mitigated', /challenge/i],
  ['x-vercel-mitigated', /challenge/i],
];

/**
 * Markup only challenge pages carry. Cloudflare's `/cdn-cgi/challenge-platform/` is not
 * here on purpose: it injects that script into ordinary pages too.
 */
const CHALLENGE_MARKUP = /_cf_chl_opt|captcha-delivery\.com|id=["']px-captcha["']|Incapsula incident ID/i;

const CHALLENGE_TITLE =
  /^(?:just a moment|attention required|checking your browser|verifying you are human|please verify you are a human|access denied|pardon our interruption)\b/i;

/** A real page may mention these words; a challenge page has little else to say. */
const CHALLENGE_PAGE_MAX_TEXT_CHARACTERS = 1000;

// pages protected from bots should not be considered in the final llms.txt
export function looksLikeBotChallenge(html: string, headers: Record<string, string> = {}): boolean {
  if (CHALLENGE_HEADERS.some(([name, value]) => value.test(headers[name] ?? ''))) return true;

  const $ = load(html);
  const title = $('title').first().text().trim();
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg').remove();
  if (body.text().replace(/\s+/g, ' ').trim().length >= CHALLENGE_PAGE_MAX_TEXT_CHARACTERS) return false;
  return CHALLENGE_TITLE.test(title) || CHALLENGE_MARKUP.test(html);
}
