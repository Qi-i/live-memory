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

/** Never reuse the legacy V2 public echo-media bucket for private tickets. */
export const V3_PRIVATE_MEDIA_BUCKET = "echo-private-media-v3";
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
  private readonly legacyBucket: string;
  private readonly privateFolder: Promise<string>;

  constructor(
    private readonly client: V3MediaStorageClient,
    bucket: string,
    ownerKey: string,
    private readonly scopeCheck: () => void,
    private readonly sourceResolver: (asset: MediaAsset) => Promise<string>,
    legacyBucket = "echo-media",
  ) {
    this.bucket = bucket.trim();
    this.owner = ownerKey.trim().toLowerCase();
    this.legacyBucket = legacyBucket.trim();
    if (!/^[a-f0-9]{64}$/.test(this.owner) || this.bucket !== V3_PRIVATE_MEDIA_BUCKET ||
        !/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(this.legacyBucket) || this.legacyBucket === this.bucket) {
      throw new Error("V3_MEDIA_INVALID_SCOPE_OR_BUCKET");
    }
    // A signed URL contains the object path. Do not expose the raw ownerKey
    // there: its value is also used as a bearer authorization credential.
    this.privateFolder = sha256(utf8.encode("live-memory-v3-media:" + this.owner));
  }

  assertScope() { this.scopeCheck(); }

  private async classifyPath(path: string): Promise<"private" | "legacy"> {
    this.assertScope();
    const folder = await this.privateFolder;
    this.assertScope();
    const malformed = path.includes("//") ||
      path.split("/").some(part => !part || part === "." || part === "..") ||
      /[?#\\\\]/.test(path);
    if (malformed) throw new Error("V3_MEDIA_FOREIGN_OR_INVALID_PATH");
    if (path.startsWith(folder + "/v3/")) return "private";
    if (path.startsWith(this.owner + "/") && !path.startsWith(this.owner + "/v3/")) {
      return "legacy";
    }
    throw new Error("V3_MEDIA_FOREIGN_OR_INVALID_PATH");
  }

  async stage(recordId: string, asset: MediaAsset): Promise<MediaAsset> {
    this.assertScope();
    if (!asset.id || !recordId || asset.recordId !== recordId) {
      throw new Error("V3_MEDIA_RECORD_ID_MISMATCH");
    }
    const storedKind = asset.storagePath ? await this.classifyPath(asset.storagePath) : null;
    if (!inlineSource(asset.src)) {
      if (!asset.storagePath || storedKind === "private") return asset;
      // V2's original bucket may be publicly readable. Copy actual bytes to
      // the new private bucket rather than publishing another legacy path.
      // Never remove the source: V2 remains the authoritative live client.
      const legacy = await this.client.storage.from(this.legacyBucket).download(asset.storagePath);
      this.assertScope();
      if (legacy.error || !legacy.data) throw new Error("V3_MEDIA_LEGACY_BYTES_UNAVAILABLE");
      return this.persistBlob(recordId, asset, legacy.data);
    }
    const resolved = await this.sourceResolver(asset);
    this.assertScope();
    if (!inlineSource(resolved)) throw new Error("V3_MEDIA_LOCAL_BYTES_UNAVAILABLE");
    const response = await fetch(resolved);
    this.assertScope();
    if (!response.ok || response.type === "opaque") throw new Error("V3_MEDIA_LOCAL_BYTES_UNAVAILABLE");
    return this.persistBlob(recordId, asset, await response.blob());
  }

  private async persistBlob(recordId: string, asset: MediaAsset, blob: Blob): Promise<MediaAsset> {
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
    const folder = await this.privateFolder;
    this.assertScope();
    const path = `${folder}/v3/${recordHash}/${assetHash}/${contentHash}.${ext}`;
    await this.classifyPath(path);
    this.assertScope();
    const store = this.client.storage.from(this.bucket);
    const result = await store.upload(path, new Blob([bytes], { type: mime }), {
      upsert: false, contentType: mime, cacheControl: "31536000",
    });
    this.assertScope();
    if (result.error) {
      if (!isDuplicateObject(result.error)) throw new Error("V3_MEDIA_STAGE_FAILED");
      // A prior hash path is safe to reuse only if its real bytes agree.
      const existing = await store.download(path);
      this.assertScope();
      if (existing.error || !existing.data || existing.data.size !== blob.size ||
          await sha256(await existing.data.arrayBuffer()) !== contentHash) {
        throw new Error("V3_MEDIA_EXISTING_OBJECT_MISMATCH");
      }
    }
    let localSrc = asset.src;
    const previousKind = asset.storagePath ? await this.classifyPath(asset.storagePath) : null;
    if (!localSrc || (previousKind === "legacy" && !inlineSource(localSrc))) {
      // After copying V2 media, replace any expiring V2 signed URL with a new
      // private V3 URL. Inline bytes stay local for immediate offline use.
      const signed = await store.createSignedUrl(path, 3600);
      this.assertScope();
      if (signed.error || !signed.data?.signedUrl) throw new Error("V3_MEDIA_SIGNING_FAILED");
      localSrc = signed.data.signedUrl;
    }
    return { ...asset, src: localSrc, storagePath: path, mimeType: mime, size: blob.size };
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
      const kind = await this.classifyPath(asset.storagePath);
      const bucket = kind === "private" ? this.bucket : this.legacyBucket;
      const cacheKey = bucket + ":" + asset.storagePath;
      let url = signed.get(cacheKey);
      if (!url) {
        const result = await this.client.storage.from(bucket).createSignedUrl(asset.storagePath, 3600);
        this.assertScope();
        if (result.error || !result.data?.signedUrl) throw new Error("V3_MEDIA_SIGNING_FAILED");
        url = result.data.signedUrl;
        signed.set(cacheKey, url);
      }
      assets.push({ ...asset, src: url, source: "supabase" });
    }
    return { ...record, media: assets };
  }
}
