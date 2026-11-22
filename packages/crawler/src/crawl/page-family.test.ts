import { describe, expect, it } from 'vitest';
import { pageFamilyKeyOf } from './page-family';

const ROOT = 'https://example.com';
const familyOf = (path: string, rootUrl = ROOT) => pageFamilyKeyOf(`https://example.com${path}`, rootUrl);

describe('pageFamilyKeyOf', () => {
  it('puts the posts of a blog in one family, whatever their dates', () => {
    expect(familyOf('/2026/Mar/3/a-post')).toBe('#/4');
    expect(familyOf('/2025/Dec/31/another-post')).toBe('#/4');
    expect(familyOf('/blog/a-post')).toBe(familyOf('/blog/another-post'));
  });

  it('keeps a listing apart from what it lists, and one area apart from another', () => {
    expect(familyOf('/tags')).not.toBe(familyOf('/tags/python'));
    expect(familyOf('/tags/python')).not.toBe(familyOf('/authors/python'));
    expect(familyOf('/2026')).not.toBe(familyOf('/2026/Mar'));
  });

  it('puts every page directly under the root in one family', () => {
    expect(familyOf('/about')).toBe('/1');
    expect(familyOf('/a-post-at-the-root/')).toBe('/1');
  });

  it('counts segments below the site’s root, and a route in the URL fragment as path', () => {
    expect(familyOf('/shop/items/one', `${ROOT}/shop`)).toBe('items/2');
    expect(familyOf('/#/posts/one')).toBe('posts/2');
  });

  it('has no family for documentation, which is never held back', () => {
    expect(familyOf('/docs/kit/routing')).toBeNull();
    expect(familyOf('/en/Guide/setup')).toBeNull();
    expect(familyOf('/handbook/2/classes.html')).toBeNull();
    expect(familyOf('/docs/anything/at/all', `${ROOT}/docs`)).toBeNull();
    expect(pageFamilyKeyOf('https://docs.example.com/latest/topics/one', 'https://docs.example.com')).toBeNull();
  });

  it('does not take a page named like documentation for a page of it', () => {
    expect(familyOf('/tags/api')).toBe('tags/2');
    expect(familyOf('/tags/documentation')).toBe(familyOf('/tags/python'));
  });

  it('has no family for the root page or a page on another host', () => {
    expect(familyOf('/')).toBeNull();
    expect(pageFamilyKeyOf('https://shop.example.com/items/one', ROOT)).toBeNull();
  });
});
