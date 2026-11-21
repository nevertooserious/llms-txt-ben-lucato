import { describe, expect, it } from 'vitest';
import { looksLikeBotChallenge } from './detect-bot-challenge';

const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

describe('looksLikeBotChallenge', () => {
  it('recognises a challenge by its response header', () => {
    expect(looksLikeBotChallenge(page('Acme', '<p>Hello</p>'), { 'cf-mitigated': 'challenge' })).toBe(true);
    expect(looksLikeBotChallenge(page('Acme', '<p>Hello</p>'), { 'x-vercel-mitigated': 'challenge' })).toBe(true);
  });

  it('recognises a challenge by its title or markup', () => {
    expect(looksLikeBotChallenge(page('Just a moment...', '<p>Checking your browser.</p>'))).toBe(true);
    expect(looksLikeBotChallenge(page('Acme', '<script>window._cf_chl_opt = {}</script>'))).toBe(true);
    expect(looksLikeBotChallenge(page('Acme', '<div id="px-captcha"></div>'))).toBe(true);
  });

  it('leaves an ordinary page alone, even with Cloudflare script injected', () => {
    const script = '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>';
    expect(looksLikeBotChallenge(page('Pricing | Acme', `<p>Plans for every team.</p>${script}`))).toBe(false);
  });

  it('leaves a long article alone even if its title matches', () => {
    expect(looksLikeBotChallenge(page('Just a moment: on patience', `<p>${'Words about waiting. '.repeat(80)}</p>`))).toBe(false);
  });
});
