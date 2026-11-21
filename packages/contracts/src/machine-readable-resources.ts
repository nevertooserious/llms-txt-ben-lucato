/**
 * Files a site publishes for machines to read, which the llms.txt lists beside its pages:
 * the site's whole content in one file, an llms.txt for one part of the site, and an
 * OpenAPI description of its API.
 */
export const MACHINE_READABLE_RESOURCE_KINDS = ['llms_full_txt', 'llms_txt_index', 'openapi_description'] as const;
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
  if (fileName === 'llms.txt') return 'llms_txt_index';
  if (/^(openapi|swagger)\.(json|ya?ml)$/.test(fileName)) return 'openapi_description';
  return null;
}
