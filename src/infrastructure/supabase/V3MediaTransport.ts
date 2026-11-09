import type { MediaAsset, EventRecord } from "../../domain";

/**
 * Private object storage is not a database transaction. Stage immutable media
 * BEFORE record CAS; only a successful CAS makes its path reachable.
 *
 * A failed CAS can leave an unreachable immutable object. Do NOT delete that
 * object immediately: another device may already reference the same content.
 * Orphan reclamation needs a separate delayed, reference-audited job.
 */
export interface V3MediaTransport {
  stage(recordId: string, asset: MediaAsset): Promise<MediaAsset>;
  hydrate(record: EventRecord): Promise<EventRecord>;
  assertScope(): void;
}
interface UploadResult { error: { message: string; statusCode?: string | number; code?: string } | null }
interface DownloadResult { data: Blob | null; error: { message: string } | null }
interface SignResult { data: { signedUrl: string } | null; error: { message: string } | null }
export interface V3MediaStorageClient {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob, options: { upsert: false; contentType: string; cacheControl: string }): PromiseLike<UploadResult>;
      download(path: string): PromiseLike<DownloadResult>;
      createSignedUrl(path: string, seconds: number): PromiseLike<SignResult>;
    };
  };
}

const MAX_ASSET = 32 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif",
};
const utf8 = new TextEncoder();
async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const exact = new Uint8Array(input.byteLength);
  exact.set(input);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", exact.buffer as ArrayBuffer));
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
}
function isDuplicateObject(error: { code?: string; statusCode?: string | number; message: string }): boolean {
  return String(error.statusCode) === "409" || error.code === "409" ||
    error.code === "AssetAlreadyExists" || /already exists|duplicate/i.test(error.message);
}
function inlineSource(src: string) { return /^(?:data:|blob:)/i.test(src); }

export class SupabaseV3MediaTransport implements V3MediaTransport {
  private readonly bucket: string;
  private readonly owner: string;

  constructor(
    private readonly client: V3MediaStorageClient,
    bucket: string,
    ownerKey: string,
    private readonly scopeCheck: () => void,
    private readonly sourceResolver: (asset: MediaAsset) => Promise<string>,
  ) {
    this.bucket = bucket.trim();
    this.owner = ownerKey.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(this.owner) || !/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(this.bucket)) {
      throw new Error("V3_MEDIA_INVALID_SCOPE_OR_BUCKET");
    }
  }

  assertScope() { this.scopeCheck(); }

  private validatePath(path: string) {
    if (!path.startsWith(this.owner + "/") || path.includes("//") ||
        path.split("/").some(part => !part || part === "." || part === "..") ||
        /[?#\\]/.test(path)) {
      throw new Error("V3_MEDIA_FOREIGN_OR_INVALID_PATH");
    }
  }

  async stage(recordId: string, asset: MediaAsset): Promise<MediaAsset> {
    this.assertScope();
    if (!asset.id || !recordId || asset.recordId !== recordId) {
      throw new Error("V3_MEDIA_RECORD_ID_MISMATCH");
    }
    // Existing valid storage references are never overwritten; their signed
    // URLs are ephemeral transport metadata and not new edits.
    if (!inlineSource(asset.src)) {
      if (asset.storagePath) this.validatePath(asset.storagePath);
      return asset;
    }
    const resolved = await this.sourceResolver(asset);
    this.assertScope();
    if (!inlineSource(resolved)) throw new Error("V3_MEDIA_LOCAL_BYTES_UNAVAILABLE");
    const response = await fetch(resolved);
    this.assertScope();
    if (!response.ok || response.type === "opaque") throw new Error("V3_MEDIA_LOCAL_BYTES_UNAVAILABLE");
    const blob = await response.blob();
    this.assertScope();
    if (!blob.size || blob.size > MAX_ASSET) throw new Error("V3_MEDIA_INVALID_SIZE");
    const mime = (blob.type || asset.mimeType || "").toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) throw new Error("V3_MEDIA_INVALID_IMAGE_TYPE");
    const bytes = await blob.arrayBuffer();
    this.assertScope();
    const [recordHash, assetHash, contentHash] = await Promise.all([
      sha256(utf8.encode(recordId)), sha256(utf8.encode(asset.id)), sha256(bytes),
    ]);
    const path = `${this.owner}/v3/${recordHash}/${assetHash}/${contentHash}.${ext}`;
    this.validatePath(path);
    this.assertScope();
    const store = this.client.storage.from(this.bucket);
    const result = await store.upload(path, new Blob([bytes], { type: mime }), {
      upsert: false, contentType: mime, cacheControl: "31536000",
    });
    this.assertScope();
    if (result.error) {
      if (!isDuplicateObject(result.error)) throw new Error("V3_MEDIA_STAGE_FAILED");
      // Reuse a pre-existing immutable key ONLY after checking its bytes.
      const existing = await store.download(path);
      this.assertScope();
      if (existing.error || !existing.data || existing.data.size !== blob.size ||
          await sha256(await existing.data.arrayBuffer()) !== contentHash) {
        throw new Error("V3_MEDIA_EXISTING_OBJECT_MISMATCH");
      }
    }
    return { ...asset, storagePath: path, mimeType: mime, size: blob.size };
  }

  async hydrate(record: EventRecord): Promise<EventRecord> {
    this.assertScope();
    if (!Array.isArray(record.media)) throw new Error("V3_MEDIA_INVALID_RECORD");
    // Recover actual signed URLs for the other device. Never store the URLs
    // in cloud JSON, and never swallow a missing private picture.
    const assets: MediaAsset[] = [];
    const signed = new Map<string, string>();
    for (const asset of record.media) {
      this.assertScope();
      if (!asset.storagePath) { assets.push(asset); continue; }
      this.validatePath(asset.storagePath);
      let url = signed.get(asset.storagePath);
      if (!url) {
        const result = await this.client.storage.from(this.bucket).createSignedUrl(asset.storagePath, 3600);
        this.assertScope();
        if (result.error || !result.data?.signedUrl) throw new Error("V3_MEDIA_SIGNING_FAILED");
        url = result.data.signedUrl;
        signed.set(asset.storagePath, url);
      }
      assets.push({ ...asset, src: url, source: "supabase" });
    }
    return { ...record, media: assets };
  }
}
