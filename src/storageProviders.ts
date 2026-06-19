export type MediaProviderKind = "supabase" | "cloudflare-r2" | "tencent-cos" | "aliyun-oss" | "s3-compatible";

export interface MediaUploadInput {
  recordId: string;
  mediaId: string;
  blob: Blob;
  mimeType: string;
}

export interface MediaUploadResult {
  storagePath: string;
  signedUrl?: string;
  publicUrl?: string;
  provider: MediaProviderKind;
}

export interface MediaStorageProvider {
  kind: MediaProviderKind;
  upload(input: MediaUploadInput): Promise<MediaUploadResult>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}

export const storageProviderNotes: Record<MediaProviderKind, string> = {
  supabase: "默认方案，和 Supabase Auth/RLS 配合最省心。",
  "cloudflare-r2": "适合大图片长期低成本保存，可用 S3 兼容 API 接入。",
  "tencent-cos": "适合微信生态和国内访问，未来小程序端可优先考虑。",
  "aliyun-oss": "国内访问成熟，适合备案域名和 CDN 场景。",
  "s3-compatible": "通用对象存储接口，方便迁移到任意 S3 兼容服务。",
};
