/**
 * A password-era personal ownerKey is not necessarily derived from the
 * current Supabase auth UUID. It may be migrated without "claiming" arbitrary
 * records only if the account's existing, JWT-protected text backups prove
 * the *entire* historical archive, not just overlapping IDs/titles.
 *
 * This comparison is client-side, read-only, and never authorizes a V3 writer
 * cutover. Its only allowed subsequent action is a copy into the same JWT
 * user's private staging bucket with original-image SHA-256 verification.
 */
export interface LegacyProvenanceRow {
  id: string;
  payload: unknown;
  deleted_at: string | null;
}
export interface LegacyProvenanceResult {
  matchedRecords: number;
  sourceDigest: string;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map(k=>
    JSON.stringify(k)+":"+canonical(object[k])).join(",") + "}";
}
function comparablePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Error("V3_LEGACY_PROVENANCE_INVALID_PAYLOAD");
  }
  const { media: _media, syncedAt: _syncedAt, ...safe } =
    input as Record<string, unknown>;
  void _media;
  void _syncedAt;
  return safe;
}
export async function verifyLegacyAccountProvenance(
  personalRows: readonly LegacyProvenanceRow[],
  accountRows: readonly LegacyProvenanceRow[],
): Promise<LegacyProvenanceResult> {
  if (!personalRows.length || !accountRows.length || 
      personalRows.length !== accountRows.length || personalRows.length>2000) {
    throw Error("V3_LEGACY_PROVENANCE_RECORD_COUNT_MISMATCH");
  }
  const account = new Map<string, LegacyProvenanceRow>();
  const seen = new Set<string>();
  for (const row of accountRows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        account.has(row.id)) throw Error("V3_LEGACY_PROVENANCE_DUPLICATE_ID");
    if ((row.payload as {id?:unknown})?.id !== row.id)
      throw Error("V3_LEGACY_PROVENANCE_INVALID_PAYLOAD");
    account.set(row.id,row);
  }
  const fingerprints: string[] = [];
  for (const row of personalRows) {
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        seen.has(row.id)) throw Error("V3_LEGACY_PROVENANCE_DUPLICATE_ID");
    seen.add(row.id);
    const backed=account.get(row.id);
    if (!backed)throw Error("V3_LEGACY_PROVENANCE_RECORD_MISMATCH");
    if ((row.payload as {id?:unknown})?.id !== row.id)
      throw Error("V3_LEGACY_PROVENANCE_INVALID_PAYLOAD");
    if (Boolean(row.deleted_at)!==Boolean(backed.deleted_at))
      throw Error("V3_LEGACY_PROVENANCE_DELETION_MISMATCH");
    const oldContent=comparablePayload(row.payload);
    const backupContent=comparablePayload(backed.payload);
    if (canonical(oldContent)!==canonical(backupContent))
      throw Error("V3_LEGACY_PROVENANCE_CONTENT_MISMATCH");
    fingerprints.push(canonical([row.id,oldContent,Boolean(row.deleted_at)]));
  }
  // Cryptographic source fingerprint; never expose raw payloads or a bearer key.
  const digest=await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(canonical(fingerprints.sort())));
  return {matchedRecords:seen.size,sourceDigest:Array.from(
    new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")};
}
