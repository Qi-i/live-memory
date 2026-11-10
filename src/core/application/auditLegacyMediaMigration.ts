import type { EventRecord } from "../../domain";

/** Pre-cutover, read-only audit. No original owner key, source path, title,
 * ticket URL, or original account identifier may enter the exported result. */
export interface LegacyMediaReference {
  id: string;
  recordId: string;
  storagePath: string;
}
export interface VerifiedLegacyMediaObject {
  sourcePathSha256: string;
  contentSha256: string;
  size: number;
  mimeType: string;
  newStoragePaths: string[];
}
export interface LegacyMediaMigrationManifest {
  format: "live-memory-v3-legacy-media-preflight";
  version: 1;
  auditedAt: string;
  objects: number;
  references: number;
  totalBytes: number;
  privateBucket: "echo-private-media-v3";
  entries: VerifiedLegacyMediaObject[];
  /** Digest of the canonical, nonsecret entries and object counts. */
  sha256: string;
}
export interface LegacyMigrationAuditIO {
  ownerKey: string;
  records: readonly EventRecord[];
  assetRows: readonly LegacyMediaReference[];
  objectNames: readonly string[];
  download(path: string): Promise<Blob>;
  assertScope(): void;
}
const SHA = /^[a-f0-9]{64}$/;
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", avif: "image/avif",
};
const text = new TextEncoder();
async function hash(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === "string" ? text.encode(value) : new Uint8Array(value);
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer));
  return Array.from(digest, n => n.toString(16).padStart(2, "0")).join("");
}
function checkPath(path: string, owner: string): string {
  if (typeof path !== "string" || !path.startsWith(owner + "/") ||
      path.includes("//") || path.split("/").some(x => !x || x === "." || x === "..") ||
      /[?#\\]/.test(path) || path.startsWith(owner + "/v3/")) {
    throw new Error("V3_LEGACY_MEDIA_FOREIGN_PATH");
  }
  const extension = path.split(".").slice(-1)[0]?.toLowerCase() || "";
  if (!Object.prototype.hasOwnProperty.call(MIME, extension)) throw new Error("V3_LEGACY_MEDIA_UNSUPPORTED_TYPE");
  return extension;
}
function key(id: string, recordId: string): string {
  return JSON.stringify([recordId, id]);
}

/** Every historical Storage object must be accounted for. An orphan object
 * or stale reference aborts the whole operation, not just that one file. */
export async function auditLegacyMediaMigration(io: LegacyMigrationAuditIO):
  Promise<LegacyMediaMigrationManifest> {
  io.assertScope();
  const owner = io.ownerKey.trim().toLowerCase();
  if (!SHA.test(owner)) throw new Error("V3_LEGACY_MEDIA_INVALID_OWNER");
  const refs = new Map<string, LegacyMediaReference>();
  const add = (source: LegacyMediaReference) => {
    const id = source.id, recordId = source.recordId, path = source.storagePath;
    if (!id?.trim() || !recordId?.trim()) throw new Error("V3_LEGACY_MEDIA_INVALID_REFERENCE");
    checkPath(path, owner);
    const idKey = key(id, recordId), earlier = refs.get(idKey);
    if (earlier && earlier.storagePath !== path) {
      throw new Error("V3_LEGACY_MEDIA_CONFLICTING_REFERENCES");
    }
    refs.set(idKey, source);
  };
  for (const row of io.assetRows) {
    if (row.storagePath) add(row);
  }
  for (const record of io.records) {
    for (const item of record.media || []) {
      if (!item.storagePath) continue;
      add({ id: item.id, recordId: record.id, storagePath: item.storagePath });
    }
  }
  const names = new Set(io.objectNames);
  if (names.size !== io.objectNames.length || names.size > 2000 ||
      refs.size > 4000) throw new Error("V3_LEGACY_MEDIA_INVALID_INVENTORY");
  for (const name of names) checkPath(name, owner);
  const grouped = new Map<string, LegacyMediaReference[]>();
  for (const ref of refs.values()) {
    if (!names.has(ref.storagePath)) throw new Error("V3_LEGACY_MEDIA_MISSING_OBJECT");
    const group = grouped.get(ref.storagePath) || [];
    group.push(ref);
    grouped.set(ref.storagePath, group);
  }
  if (grouped.size !== names.size) throw new Error("V3_LEGACY_MEDIA_ORPHAN_OBJECT");
  const blindedOwner = await hash("live-memory-v3-media:" + owner);
  io.assertScope();
  const entries: VerifiedLegacyMediaObject[] = [];
  let totalBytes = 0;
  for (const path of [...grouped.keys()].sort()) {
    io.assertScope();
    const extension = checkPath(path, owner);
    const blob = await io.download(path);
    io.assertScope();
    if (!blob || blob.size < 1 || blob.size > 32 * 1024 * 1024 ||
        totalBytes + blob.size > 256 * 1024 * 1024) {
      throw new Error("V3_LEGACY_MEDIA_BYTES_UNAVAILABLE");
    }
    const actualMime = blob.type?.toLowerCase() || "";
    const expectedMime = MIME[extension];
    if (actualMime && actualMime !== "application/octet-stream" && actualMime !== expectedMime) {
      throw new Error("V3_LEGACY_MEDIA_MIME_MISMATCH");
    }
    const contentSha256 = await hash(await blob.arrayBuffer());
    io.assertScope();
    const newStoragePaths: string[] = [];
    for (const asset of grouped.get(path) || []) {
      const [recordHash, assetHash] = await Promise.all([
        hash(asset.recordId), hash(asset.id),
      ]);
      io.assertScope();
      const target = blindedOwner + "/v3/" + recordHash + "/" + assetHash +
        "/" + contentSha256 + "." + (extension === "jpeg" ? "jpg" : extension);
      if (!newStoragePaths.includes(target)) newStoragePaths.push(target);
    }
    entries.push({
      sourcePathSha256: await hash(path),
      contentSha256, size: blob.size, mimeType: expectedMime,
      newStoragePaths: newStoragePaths.sort(),
    });
    totalBytes += blob.size;
  }
  io.assertScope();
  const sorted = entries.sort((a,b) => a.sourcePathSha256.localeCompare(b.sourcePathSha256));
  const digest = await hash(JSON.stringify({entries:sorted,objects:names.size,references:refs.size,totalBytes}));
  io.assertScope();
  return {
    format: "live-memory-v3-legacy-media-preflight", version:1,
    auditedAt:new Date().toISOString(), objects:names.size,
    references:refs.size,totalBytes,privateBucket:"echo-private-media-v3",
    entries:sorted,sha256:digest,
  };
}
