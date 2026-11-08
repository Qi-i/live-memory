import type { EventRecord, MediaAsset } from "../../domain";

/**
 * The record's *meaningful* revision. Cloud transport URLs, sync timestamps,
 * upload provenance and record creation timestamps are not user edits.
 *
 * No framework, localStorage, clock, network or database dependency is allowed
 * inside this module: it must be portable to a future Android data client.
 */
function canonicalMedia(asset: MediaAsset) {
  const {
    src, source: _source, updatedAt: _updatedAt, createdAt: _createdAt,
    ...stable
  } = asset;
  return {
    ...stable,
    // Signed URLs rotate and must never constitute a new media revision.
    // Local-only image bytes remain part of the revision until uploaded.
    src: asset.storagePath ? "" : src,
  };
}

export function canonicalRecord(record: EventRecord, includeMedia = true): unknown {
  const {
    schemaVersion: _schemaVersion, syncedAt: _syncedAt,
    updatedAt: _updatedAt, createdAt: _createdAt,
    media, mediaTombstones, ...content
  } = record;
  return {
    ...content,
    media: includeMedia
      ? media.map(canonicalMedia).sort((a, b) => a.id.localeCompare(b.id))
      : [],
    mediaTombstones: includeMedia
      ? (mediaTombstones ?? []).map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id))
      : [],
  };
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}

export function recordContentEqual(
  left: EventRecord, right: EventRecord, includeMedia = true,
): boolean {
  return stableSerialize(canonicalRecord(left, includeMedia))
    === stableSerialize(canonicalRecord(right, includeMedia));
}

/**
 * SHA-256 makes persisted baselines compact without exposing private notes,
 * ticket information or image data in the metadata store.
 * No weak non-cryptographic hash is used to decide whether to overwrite data.
 */
export async function recordRevision(
  record: EventRecord,
  includeMedia = true,
): Promise<string> {
  const value = stableSerialize(canonicalRecord(record, includeMedia));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
