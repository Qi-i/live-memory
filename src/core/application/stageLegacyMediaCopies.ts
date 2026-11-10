import type { LegacyMediaMigrationManifest } from "./auditLegacyMediaMigration";

export interface LegacyMediaStagingIO {
  accountUserId: string;
  /** Ephemeral source paths, NEVER included in output. */
  sourcePaths: readonly string[];
  downloadOriginal(path: string): Promise<Blob>;
  /** Upsert must always be false: immutable objects cannot be replaced. */
  uploadPrivate(path: string, blob: Blob, mimeType: string): Promise<"uploaded" | "exists">;
  downloadPrivate(path: string): Promise<Blob>;
  assertScope(): void;
}
export interface LegacyMediaStagingResult {
  objectsVerified: number;
  copiesVerified: number;
  bytesVerified: number;
  manifestSha256: string;
  privateBucket: "echo-v3-media-staging";
}
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const encoder = new TextEncoder();
async function sha256(data: string | ArrayBuffer) {
  const src = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer));
  return Array.from(result,n=>n.toString(16).padStart(2,"0")).join("");
}
/**
 * Resumable and non-destructive. The SOURCE file is checked against the
 * preflight hash and every staged copy is independently downloaded and checked
 * before a successful result is emitted. Partial uploads are safe and can be
 * retried; no V2 record, media, credential or writer marker is modified.
 */
export async function stageLegacyMediaCopies(
  proof: LegacyMediaMigrationManifest,
  io: LegacyMediaStagingIO,
): Promise<LegacyMediaStagingResult> {
  io.assertScope();
  const userId=io.accountUserId.toLowerCase();
  if(!uuid.test(userId) ||
    proof?.format!=="live-memory-v3-legacy-media-preflight" ||
    proof.version!==1 || !hex.test(proof.sha256) ||
    !Array.isArray(proof.entries) || proof.objects!==proof.entries.length ||
    proof.objects>2000 || proof.totalBytes>256*1024*1024) {
    throw Error("V3_STAGING_INVALID_PROOF");
  }
  const sourceByHash=new Map<string,string>();
  for(const name of io.sourcePaths) {
    const digest=await sha256(name);
    io.assertScope();
    if(sourceByHash.has(digest))throw Error("V3_STAGING_DUPLICATE_SOURCE");
    sourceByHash.set(digest,name);
  }
  if(sourceByHash.size!==proof.objects) throw Error("V3_STAGING_SOURCE_INVENTORY_CHANGED");
  const seenTargets=new Set<string>();
  let verified=0,bytes=0;
  for(const entry of proof.entries) {
    io.assertScope();
    if(!entry || !hex.test(entry.sourcePathSha256) || !hex.test(entry.contentSha256) ||
      !Number.isSafeInteger(entry.size) || entry.size<1 || entry.size>32*1024*1024 ||
      !Array.isArray(entry.newStoragePaths) || entry.newStoragePaths.length===0) {
      throw Error("V3_STAGING_INVALID_PROOF");
    }
    const source=sourceByHash.get(entry.sourcePathSha256);
    if(!source) throw Error("V3_STAGING_SOURCE_INVENTORY_CHANGED");
    const blob=await io.downloadOriginal(source);
    io.assertScope();
    if(!blob || blob.size!==entry.size ||
       await sha256(await blob.arrayBuffer())!==entry.contentSha256) {
      throw Error("V3_STAGING_SOURCE_BYTES_CHANGED");
    }
    io.assertScope();
    for(const blindedTarget of entry.newStoragePaths) {
      const match=blindedTarget.match(
        /^[a-f0-9]{64}(\/v3\/[a-f0-9]{64}\/[a-f0-9]{64}\/([a-f0-9]{64})\.(jpg|png|webp|gif|avif))$/
      );
      if(!match||match[2]!==entry.contentSha256)throw Error("V3_STAGING_INVALID_TARGET");
      const path=userId+match[1];
      if(seenTargets.has(path))throw Error("V3_STAGING_DUPLICATE_TARGET");
      seenTargets.add(path);
      const actualType=(blob.type&&blob.type!=="application/octet-stream")
        ?blob.type.toLowerCase():entry.mimeType;
      if(actualType!==entry.mimeType)throw Error("V3_STAGING_MIME_MISMATCH");
      // A 409 means immutable bytes MAY already exist. Always re-download and
      // verify the exact SHA before treating retry as success.
      await io.uploadPrivate(path,blob,entry.mimeType);
      io.assertScope();
      const staged=await io.downloadPrivate(path);
      io.assertScope();
      if(!staged || staged.size!==entry.size ||
        await sha256(await staged.arrayBuffer())!==entry.contentSha256) {
        throw Error("V3_STAGING_PRIVATE_BYTES_MISMATCH");
      }
      verified+=1;
    }
    bytes+=blob.size;
    io.assertScope();
  }
  if(bytes!==proof.totalBytes)throw Error("V3_STAGING_SOURCE_INVENTORY_CHANGED");
  return {
    objectsVerified:proof.objects,copiesVerified:verified,
    bytesVerified:bytes,manifestSha256:proof.sha256,
    privateBucket:"echo-v3-media-staging",
  };
}
