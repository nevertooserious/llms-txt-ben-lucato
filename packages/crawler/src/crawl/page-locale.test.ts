import { describe, expect, it } from 'vitest';
import { isTranslation, pageLocaleOf } from './page-locale';

const ROOT = 'https://example.com';
const site = (languages: string[], pages: string[] = []) => ({
  languagesAtSlot: new Set(languages),
  hasPage: (url: string) => pages.includes(url),
});

describe('pageLocaleOf', () => {
  it('reads a language from the first or second directory below the root', () => {
    expect(pageLocaleOf(`${ROOT}/de/pricing`, ROOT)).toEqual({ slotKey: '', language: 'de', urlWithoutLocale: `${ROOT}/pricing` });
    expect(pageLocaleOf(`${ROOT}/docs/pt-BR/intro`, ROOT)).toEqual({ slotKey: 'docs', language: 'pt', urlWithoutLocale: `${ROOT}/docs/intro` });
    expect(pageLocaleOf('https://example.com/shop/fr/cart', 'https://example.com/shop')?.language).toBe('fr');
  });

  it('is null for sections that are not languages, deeper directories and other hosts', () => {
    expect(pageLocaleOf(`${ROOT}/ai/agents`, ROOT)).toBeNull();
    expect(pageLocaleOf(`${ROOT}/pricing`, ROOT)).toBeNull();
    expect(pageLocaleOf(`${ROOT}/a/b/de/page`, ROOT)).toBeNull();
    expect(pageLocaleOf('https://docs.example.com/de/page', ROOT)).toBeNull();
  });
});

describe('isTranslation', () => {
  const german = pageLocaleOf(`${ROOT}/de/pricing`, ROOT);

  it('is a page in another language where the site’s own language has a directory too', () => {
    expect(isTranslation(german, 'en', site(['en', 'de']))).toBe(true);
    expect(isTranslation(pageLocaleOf(`${ROOT}/en/pricing`, ROOT), 'en', site(['en', 'de']))).toBe(false);
  });

  it('is one of several languages, or a copy of a page that exists without the directory', () => {
    expect(isTranslation(german, 'en', site(['de', 'fr', 'es']))).toBe(true);
    expect(isTranslation(german, 'en', site(['de'], [`${ROOT}/pricing`]))).toBe(true);
  });

  it('is not a lone directory named like a language, nor anything before the site’s language is known', () => {
    expect(isTranslation(pageLocaleOf(`${ROOT}/it/helpdesk`, ROOT), 'en', site(['it']))).toBe(false);
    expect(isTranslation(german, null, site(['en', 'de']))).toBe(false);
    expect(isTranslation(null, 'en', site([]))).toBe(false);
  });
});
