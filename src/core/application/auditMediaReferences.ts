/**
 * Read-only inventory comparison. An unreferenced object is a CANDIDATE for
 * investigation, never proof that deletion is safe: offline clients, stale
 * snapshots, and in-flight uploads can all hold references.
 * No Storage mutation is exposed by this module.
 */
export interface MediaAuditObject { bucket: string; path: string }
export interface MediaAuditReference extends MediaAuditObject { source: string }
export interface MediaAuditResult {
  referenced: MediaAuditObject[];
  unreferencedCandidates: MediaAuditObject[];
  missingObjects: MediaAuditObject[];
  incomplete: boolean;
}
const key = (bucket: string, path: string) => JSON.stringify([bucket,path]);
function valid(item: MediaAuditObject): boolean {
  return typeof item?.bucket === "string" && !!item.bucket.trim() &&
    typeof item?.path === "string" && !!item.path.trim() &&
    !item.path.startsWith("/") && !item.path.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(item.path) &&
    !item.path.split("/").includes("..");
}
export function auditMediaReferences(input: {
  objects: readonly MediaAuditObject[];
  references: readonly MediaAuditReference[];
  inventoryComplete: boolean;
  referencesComplete: boolean;
}): MediaAuditResult {
  if (!Array.isArray(input.objects) || !Array.isArray(input.references) ||
      typeof input.inventoryComplete !== "boolean" ||
      typeof input.referencesComplete !== "boolean") {
    throw new Error("V3_MEDIA_AUDIT_INVALID_INPUT");
  }
  if (input.objects.some(x => !valid(x)) ||
      input.references.some(x => !valid(x) || typeof x.source !== "string" || !x.source.trim())) {
    throw new Error("V3_MEDIA_AUDIT_INVALID_INPUT");
  }
  const objects = new Map(input.objects.map(x => [key(x.bucket,x.path), x]));
  const references = new Map(input.references.map(x => [key(x.bucket,x.path), x]));
  if (objects.size !== input.objects.length) {
    throw new Error("V3_MEDIA_AUDIT_DUPLICATE_OBJECT");
  }
  const incomplete = !input.inventoryComplete || !input.referencesComplete;
  const sort = (a: MediaAuditObject,b: MediaAuditObject) =>
    a.bucket.localeCompare(b.bucket) || a.path.localeCompare(b.path);
  return {
    referenced: [...objects].filter(([k]) => references.has(k)).map(([,v]) => v).sort(sort),
    // Incomplete scans cannot establish that ANY object is unreferenced.
    unreferencedCandidates: incomplete ? [] :
      [...objects].filter(([k]) => !references.has(k)).map(([,v]) => v).sort(sort),
    missingObjects: input.inventoryComplete ?
      [...references].filter(([k]) => !objects.has(k)).map(([,v]) => ({bucket:v.bucket,path:v.path})).sort(sort) : [],
    incomplete,
  };
}
