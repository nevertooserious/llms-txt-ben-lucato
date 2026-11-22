import type { GeneratorPage } from '@llms-txt/contracts';
import { homepageOf } from './page-kinds';

/** Fewer posts than this on a homepage are a site's latest news, not what the site is. */
const MINIMUM_POSTS_LINKED_BY_HOMEPAGE = 5;

/**
 * The posts a blog's homepage links. The assessment leaves out a single post, because on
 * most sites the blog stands beside what the site offers. On a blog or an online magazine
 * the posts are what the site offers, and a file without them lists next to nothing.
 *
 * Such a site is told by its homepage, which is the index of its posts: most of the
 * assessed pages it links are single posts. The homepage of a company or a project links
 * its products and documentation, and a few recent posts among them. Judged here rather
 * than by the model, which reads one page at a time and cannot know what the rest of the
 * site is; so a page's assessment still depends on that page alone.
 *
 * Only the posts the homepage links are listed. The site chose them, as it chooses what
 * its navigation links, and on a blog too large to crawl whole they are its newest, not
 * whichever the crawl reached.
 */
export function postsLinkedByHomepage(pages: readonly GeneratorPage[]): GeneratorPage[] {
  const homepage = homepageOf(pages);
  if (homepage === undefined) return [];
  const linkedUrls = new Set(homepage.outboundLinkUrls);
  const assessedLinkedPages = pages.filter(
    (page) => page !== homepage && page.assessment !== null && linkedUrls.has(page.record.normalisedUrl),
  );
  const posts = assessedLinkedPages.filter((page) => page.assessment?.exclusionReason === 'individual_content');
  const isMostlyPosts = posts.length >= MINIMUM_POSTS_LINKED_BY_HOMEPAGE && posts.length * 2 > assessedLinkedPages.length;
  return isMostlyPosts ? posts : [];
}
