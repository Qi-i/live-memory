import type { EventRecord } from "../../domain";
import { stableSerialize } from "../sync/revision";
import {
  verifyPortableBackupDocument,
  type PortableBackupDocument,
} from "./portableMediaBackup";

/**
 * Additive, authenticated-scope-safe portable restore. Source files are
 * verified BEFORE the local transaction. New rows are checked again after
 * commit against the exact embedded image bytes. Existing rows are never
 * overwritten, and conflicting IDs abort the entire transaction.
 *
 * Cloud writers/cutover must be authorized separately; this restores ONLY
 * the currently scoped device archive and does not start remote sync.
 */
export interface V3AtomicRestorePort {
  insertMissingAtomic(records: readonly EventRecord[]): Promise<{
    insertedIds: string[];
    alreadyPresentIds: string[];
  }>;
  list(): Promise<EventRecord[]>;
}
export interface V3RestoreResult {
  inserted: number;
  alreadyPresent: number;
  verifiedAssets: number;
  verifiedBytes: number;
}

export async function restoreVerifiedPortableArchive(
  value: unknown,
  repository: V3AtomicRestorePort,
  assertScope: () => void,
): Promise<V3RestoreResult> {
  assertScope();
  // Reject edited, truncated, URL-only and non-portable files before any write.
  const full = await verifyPortableBackupDocument(value);
  assertScope();
  const backup = value as PortableBackupDocument;
  if (full.records !== backup.records.length ||
      !Array.isArray(backup.portableMediaManifest.assets)) {
    throw new Error("V3_RESTORE_INVALID_ARCHIVE");
  }
  const ids = new Set(backup.records.map(row => row.id));
  if (ids.size !== backup.records.length) throw new Error("V3_RESTORE_INVALID_ARCHIVE");
  const result = await repository.insertMissingAtomic(backup.records);
  assertScope();
  if (result.insertedIds.length + result.alreadyPresentIds.length !== backup.records.length) {
    throw new Error("V3_RESTORE_INCOMPLETE_TRANSACTION");
  }
  const inserted = new Set(result.insertedIds);
  const actual = new Map((await repository.list()).map(row => [row.id, row]));
  assertScope();
  const exportedRows = new Map(backup.records.map(row => [row.id, row]));
  const restored: EventRecord[] = [];
  for (const id of inserted) {
    const expected = exportedRows.get(id);
    const stored = actual.get(id);
    if (!expected || !stored || stableSerialize(stored) !== stableSerialize(expected)) {
      // Rows are additive, so even a failed verification NEVER deletes originals.
      // The caller must not claim success until a review establishes fidelity.
      throw new Error("V3_RESTORE_READBACK_CONTENT_MISMATCH");
    }
    restored.push(stored);
  }
  const entries = backup.portableMediaManifest.assets.filter(item => inserted.has(item.recordId));
  const postWrite = await verifyPortableBackupDocument({
    ...backup,
    records: restored,
    portableMediaManifest: {
      ...backup.portableMediaManifest,
      assets: entries,
      totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  });
  assertScope();
  return {
    inserted: result.insertedIds.length,
    alreadyPresent: result.alreadyPresentIds.length,
    verifiedAssets: postWrite.assets,
    verifiedBytes: postWrite.totalBytes,
  };
}
