import type { GeneratorPage } from '@llms-txt/contracts';
import { pathSegmentsOf } from './url-paths';

/** An inbound-link score above this says "linked from a template", not "more important". */
const MAXIMUM_INBOUND_LINK_SCORE = 3;
/** Taken off per path segment beyond the first: deep pages are details of shallower ones. */
const PATH_DEPTH_PENALTY = 0.5;

/**
 * How important a page looks from how the site links it: being in the navigation counts
 * most, then nearness to the homepage, then how many pages link to it, up to a point: a
 * sidebar that links every filter page from every listing page says nothing about them.
 * A page the site's own llms.txt lists gets a lift, since the site chose it, and a page
 * deep in the URL tree loses a little.
 */
export function scorePage(page: GeneratorPage): number {
  const signals = page.crawlSignals;
  return (
    (signals.isInSiteNavigation ? 4 : 0) +
    3 / (1 + signals.crawlDepth) +
    Math.min(Math.log2(1 + signals.inboundLinkCount), MAXIMUM_INBOUND_LINK_SCORE) +
    (signals.discoveredVia === 'existing_llms_txt' ? 2 : 0) -
    PATH_DEPTH_PENALTY * Math.max(0, pathSegmentsOf(page.record.normalisedUrl).length - 1)
  );
}
