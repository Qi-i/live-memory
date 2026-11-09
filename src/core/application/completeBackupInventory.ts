import type { EventRecord, MediaAsset } from "../../domain";
import type { CloudRecordEnvelope } from "../ports/CloudRecordAdapter";
import { recordContentEqual } from "../sync/revision";

/**
 * A verified portable export must include the COMPLETE inventory, not merely
 * the device's IndexedDB rows. Historical cloud-only records are otherwise
 * permanently omitted when a new device restores that "complete" backup.
 *
 * Never guess which version is newer. Identical semantic copies are merged
 * only to recover usable temporary media src values (never cloud-write).
 * Any distinct content under the same record ID blocks the whole export.
 */
export interface CompleteBackupInventory {
  records: EventRecord[];
  counts: {
    local: number;
    remote: number;
    shared: number;
    localOnly: number;
    remoteOnly: number;
    total: number;
  };
}

function uniqueRecords<T>(
  rows: readonly T[], getId: (row: T) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = getId(row);
    if (!id?.trim() || result.has(id)) {
      throw new Error("V3_COMPLETE_BACKUP_INVALID_INVENTORY");
    }
    result.set(id, row);
  }
  return result;
}

function withBestAvailableSources(
  local: EventRecord, remote: EventRecord,
): EventRecord {
  const byAssetId = new Map((remote.media || []).map(asset => [asset.id, asset]));
  const media = local.media.map((asset): MediaAsset => {
    const other = byAssetId.get(asset.id);
    if (!other || other.storagePath !== asset.storagePath) return asset;
    // Inline file bytes are the most portable local source; otherwise use the
    // freshly hydrated cloud Storage URL instead of an expired local URL.
    if (/^data:/i.test(asset.src || "")) return asset;
    return other.src ? { ...asset, src: other.src } : asset;
  });
  return { ...local, media };
}

export function completeBackupInventory(
  local: readonly EventRecord[],
  cloud: readonly CloudRecordEnvelope[],
): CompleteBackupInventory {
  const here = uniqueRecords(local, item => item.id);
  const there = uniqueRecords(cloud, item => item.record.id);
  const records: EventRecord[] = [];
  let shared = 0, localOnly = 0, remoteOnly = 0, divergent = 0;
  for (const [id, record] of here) {
    const remote = there.get(id);
    if (!remote) {
      records.push(record);
      localOnly += 1;
      continue;
    }
    if (remote.record.id !== id || !remote.serverRevision?.trim()) {
      throw new Error("V3_COMPLETE_BACKUP_INVALID_REMOTE_REVISION");
    }
    shared += 1;
    if (!recordContentEqual(record, remote.record, true)) {
      divergent += 1;
      continue;
    }
    records.push(withBestAvailableSources(record, remote.record));
  }
  for (const [id, envelope] of there) {
    if (here.has(id)) continue;
    if (envelope.record.id !== id || !envelope.serverRevision?.trim()) {
      throw new Error("V3_COMPLETE_BACKUP_INVALID_REMOTE_REVISION");
    }
    records.push(envelope.record);
    remoteOnly += 1;
  }
  // Field-level disagreements might include ticket bytes or private notes.
  // The report deliberately contains only counts, never user field contents.
  if (divergent) {
    throw new Error("V3_COMPLETE_BACKUP_DIVERGENT_RECORDS");
  }
  records.sort((a, b) => b.date.localeCompare(a.date));
  return {
    records,
    counts: {
      local: here.size, remote: there.size, shared,
      localOnly, remoteOnly, total: records.length,
    },
  };
}

/** A remote page can change during a multi-minute media export. Never call a
 * stale snapshot "complete" if ANY row was added/removed/updated. */
export function verifyBackupCloudUnchanged(
  before: readonly CloudRecordEnvelope[],
  after: readonly CloudRecordEnvelope[],
): void {
  const original = uniqueRecords(before, row => row.record.id);
  const current = uniqueRecords(after, row => row.record.id);
  if (original.size !== current.size) throw new Error("V3_COMPLETE_BACKUP_CLOUD_CHANGED");
  for (const [id, old] of original) {
    const next = current.get(id);
    if (!next || old.serverRevision !== next.serverRevision ||
        !recordContentEqual(old.record, next.record, true)) {
      throw new Error("V3_COMPLETE_BACKUP_CLOUD_CHANGED");
    }
  }
}
