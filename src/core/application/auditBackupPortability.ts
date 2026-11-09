import type { EventRecord } from "../../domain";

/**
 * A JSON export only embeds binary media if its src is an actual data URL.
 * URLs (even signed storage URLs), storage paths and transient blob URLs are
 * references, not recoverable picture bytes. Conservative metadata-only audit.
 */
export interface BackupPortabilityAudit {
  records: number;
  assets: number;
  embeddedCandidates: number;
  storageReferences: number;
  transientBlobReferences: number;
  externalReferences: number;
  unavailableReferences: number;
  requiresSeparateMediaBackup: boolean;
}

export function auditBackupPortability(records: ReadonlyArray<Pick<EventRecord, "media">>): BackupPortabilityAudit {
  const result: BackupPortabilityAudit = {
    records: records.length,
    assets: 0,
    embeddedCandidates: 0,
    storageReferences: 0,
    transientBlobReferences: 0,
    externalReferences: 0,
    unavailableReferences: 0,
    requiresSeparateMediaBackup: false,
  };
  for (const record of records) {
    const media = Array.isArray(record.media) ? record.media : [];
    for (const asset of media) {
      result.assets += 1;
      const src = typeof asset.src === "string" ? asset.src.trim() : "";
      // Embedded candidates still require file integrity checks before a
      // backup can be called verified. This only detects missing raw bytes.
      if (/^data:[^,]*,/i.test(src)) result.embeddedCandidates += 1;
      else if (asset.storagePath) result.storageReferences += 1;
      else if (/^blob:/i.test(src)) result.transientBlobReferences += 1;
      else if (/^https?:\/\//i.test(src)) result.externalReferences += 1;
      else result.unavailableReferences += 1;
    }
  }
  result.requiresSeparateMediaBackup = result.assets > result.embeddedCandidates;
  return result;
}
