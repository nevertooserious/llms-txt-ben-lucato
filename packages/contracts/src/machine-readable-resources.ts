/**
 * Files a site publishes for machines to read, which the llms.txt lists beside its pages:
 * the site's whole content in one file, other versions of that file (`llms-small.txt`,
 * `llms-medium.txt`), an llms.txt for one part of the site, and an OpenAPI description of
 * its API.
 */
export const MACHINE_READABLE_RESOURCE_KINDS = [
  'llms_full_txt',
  'llms_text_variant',
  'llms_txt_index',
  'openapi_description',
] as const;
export type MachineReadableResourceKind = (typeof MACHINE_READABLE_RESOURCE_KINDS)[number];

/** Which kind of machine-readable file a URL names, going by its file name; null for any other URL. */
export function machineReadableResourceKindOf(url: string): MachineReadableResourceKind | null {
  let fileName: string;
  try {
    fileName = new URL(url).pathname.split('/').pop()!.toLowerCase();
  } catch {
    return null;
  }
  if (fileName === 'llms-full.txt') return 'llms_full_txt';
  // Sites name shorter versions as they like: `llms-small.txt`, `llms-medium.txt`, `llms-ctx.txt`.
  if (/^llms-[a-z0-9][a-z0-9._-]*\.txt$/.test(fileName)) return 'llms_text_variant';
  if (fileName === 'llms.txt') return 'llms_txt_index';
  // Also one API's among several: `billing-openapi.json`, `openapi-v2.yaml`.
  if (/^(?:[a-z0-9]+[-_.])*(?:openapi|swagger)(?:[-_.][a-z0-9]+)*\.(?:json|ya?ml)$/.test(fileName)) return 'openapi_description';
  return null;
}
