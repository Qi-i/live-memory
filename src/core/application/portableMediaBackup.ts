import type { EventRecord, MediaAsset } from "../../domain";

/**
 * Explicit user-downloadable V3 migration backup.
 *
 * References (blob:, signed URL, Storage path) are NOT recoverable picture
 * bytes. Convert every referenced media item to embedded data bytes and hash
 * the exact contents. Abort the ENTIRE export on any missing image or account
 * switch; neither local archives nor remote Storage is modified.
 */
export interface PortableMediaEntry {
  recordId: string;
  assetId: string;
  bytes: number;
  mimeType: string;
  sha256: string;
}
export interface PortableMediaManifest {
  version: 1;
  assets: PortableMediaEntry[];
  totalBytes: number;
}
export interface PortableBackupDocument {
  app: "live-memory";
  version: 3;
  mediaIncluded: true;
  exportedAt: string;
  records: EventRecord[];
  portableMediaManifest: PortableMediaManifest;
}
export interface PortableBackupMediaIO {
  load(asset: MediaAsset): Promise<Blob>;
  encode(blob: Blob): Promise<string>;
  /** Called before/after each asynchronous operation to fence an account switch. */
  assertScope(): void;
}
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

async function sha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
}
function manifestKey(recordId: string, assetId: string) {
  return JSON.stringify([recordId, assetId]);
}

export async function createPortableBackup(
  records: EventRecord[],
  io: PortableBackupMediaIO,
): Promise<PortableBackupDocument> {
  const seenRecordIds = new Set<string>();
  const entries: PortableMediaEntry[] = [];
  const portable: EventRecord[] = [];
  let total = 0;
  io.assertScope();

  for (const record of records) {
    if (!record.id || seenRecordIds.has(record.id)) {
      throw new Error("V3_BACKUP_DUPLICATE_RECORD");
    }
    seenRecordIds.add(record.id);
    const seenAssets = new Set<string>();
    const media: MediaAsset[] = [];
    for (const asset of record.media || []) {
      io.assertScope();
      if (!asset.id || seenAssets.has(asset.id)) {
        throw new Error("V3_BACKUP_DUPLICATE_ASSET");
      }
      seenAssets.add(asset.id);
      const source = await io.load(asset);
      io.assertScope();
      if (!source || !source.size || source.size > MAX_ASSET_BYTES ||
          total + source.size > MAX_TOTAL_BYTES) {
        throw new Error("V3_BACKUP_MEDIA_MISSING_OR_TOO_LARGE");
      }
      if (source.type === "text/html") {
        throw new Error("V3_BACKUP_MEDIA_INVALID_RESPONSE");
      }
      const mimeType = source.type || asset.mimeType || "application/octet-stream";
      const blob = source.type ? source : new Blob([source], { type: mimeType });
      const hash = await sha256(blob);
      io.assertScope();
      const encoded = await io.encode(blob);
      io.assertScope();
      if (!/^data:[^,]+;base64,/i.test(encoded)) {
        throw new Error("V3_BACKUP_MEDIA_ENCODING_INVALID");
      }
      entries.push({
        recordId: record.id, assetId: asset.id, bytes: blob.size,
        mimeType, sha256: hash,
      });
      total += blob.size;
      // Export a true portable asset. A Storage path from the old account
      // must not suppress a future reupload into a different user's cloud.
      media.push({
        ...asset, src: encoded, storagePath: undefined, source: "local",
        mimeType, size: blob.size,
      });
    }
    portable.push({
      ...record,
      media,
      mediaTombstones: record.mediaTombstones?.map(item => ({
        ...item, storagePath: undefined,
      })),
    });
  }

  io.assertScope();
  return {
    app: "live-memory", version: 3, mediaIncluded: true,
    exportedAt: new Date().toISOString(),
    records: portable,
    portableMediaManifest: { version: 1, assets: entries, totalBytes: total },
  };
}

export async function verifyPortableBackupDocument(value: unknown): Promise<{
  records: number; assets: number; totalBytes: number;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("V3_BACKUP_INVALID_CONTAINER");
  }
  const doc = value as Partial<PortableBackupDocument>;
  const manifest = doc.portableMediaManifest;
  if (doc.app !== "live-memory" || doc.version !== 3 ||
      doc.mediaIncluded !== true || !Array.isArray(doc.records) ||
      !manifest || manifest.version !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error("V3_BACKUP_INVALID_MANIFEST");
  }
  const expected = new Map<string, PortableMediaEntry>();
  let declaredTotal = 0;
  for (const item of manifest.assets) {
    if (!item || typeof item.recordId !== "string" ||
        typeof item.assetId !== "string" || !item.recordId || !item.assetId ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        item.bytes > MAX_ASSET_BYTES ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        typeof item.mimeType !== "string") {
      throw new Error("V3_BACKUP_INVALID_ASSET_ENTRY");
    }
    const key = manifestKey(item.recordId, item.assetId);
    if (expected.has(key)) throw new Error("V3_BACKUP_DUPLICATE_ASSET_ENTRY");
    expected.set(key, item);
    declaredTotal += item.bytes;
    if (declaredTotal > MAX_TOTAL_BYTES) throw new Error("V3_BACKUP_TOO_LARGE");
  }
  if (declaredTotal !== manifest.totalBytes) throw new Error("V3_BACKUP_SIZE_MISMATCH");

  let verified = 0;
  const seenRecords = new Set<string>();
  for (const row of doc.records) {
    if (!row || typeof row.id !== "string" || !row.id ||
        seenRecords.has(row.id) || !Array.isArray(row.media)) {
      throw new Error("V3_BACKUP_INVALID_RECORDS");
    }
    seenRecords.add(row.id);
    const seenMedia = new Set<string>();
    for (const asset of row.media) {
      if (!asset || typeof asset.id !== "string" || !asset.id ||
          seenMedia.has(asset.id) || asset.storagePath ||
          typeof asset.src !== "string" ||
          !/^data:[^,]+;base64,/i.test(asset.src)) {
        throw new Error("V3_BACKUP_MEDIA_NOT_PORTABLE");
      }
      seenMedia.add(asset.id);
      const expectedItem = expected.get(manifestKey(row.id, asset.id));
      if (!expectedItem) throw new Error("V3_BACKUP_UNLISTED_MEDIA");
      let blob: Blob;
      try {
        const response = await fetch(asset.src);
        if (!response.ok) throw new Error("V3_BACKUP_MEDIA_DECODE_FAILED");
        blob = await response.blob();
      } catch {
        throw new Error("V3_BACKUP_MEDIA_DECODE_FAILED");
      }
      if (blob.type.toLowerCase() !== expectedItem.mimeType.toLowerCase()) {
        throw new Error("V3_BACKUP_MEDIA_TYPE_MISMATCH");
      }
      if (blob.size !== expectedItem.bytes || await sha256(blob) !== expectedItem.sha256) {
        throw new Error("V3_BACKUP_MEDIA_HASH_MISMATCH");
      }
      verified += 1;
    }
  }
  if (verified !== expected.size) throw new Error("V3_BACKUP_MEDIA_COUNT_MISMATCH");
  return { records: doc.records.length, assets: verified, totalBytes: declaredTotal };
}
