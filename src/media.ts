import { createId, MediaAsset, MediaKind } from "./domain";
import { normalizeLegacyAssetUrl } from "./posterRegistry";

export function nowIso() {
  return new Date().toISOString();
}

export function makeMedia(recordId: string, kind: MediaKind, src: string, title?: string, source: MediaAsset["source"] = "external"): MediaAsset {
  const timestamp = nowIso();
  return {
    id: createId("media"),
    recordId,
    kind,
    src: normalizeLegacyAssetUrl(src),
    title,
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function fileToMedia(recordId: string, kind: MediaKind, file: File): Promise<MediaAsset> {
  const compressed = await compressImage(file);
  const timestamp = nowIso();
  return {
    id: createId("media"),
    recordId,
    kind,
    src: compressed.src,
    title: file.name,
    width: compressed.width,
    height: compressed.height,
    mimeType: compressed.mimeType,
    size: compressed.size,
    source: "local",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function fileToAvatar(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.size > 10 * 1024 * 1024) throw new Error("头像图片不能超过 10MB");
  const result = await compressImage(file, 320, 0.84);
  if (result.size > 420 * 1024) throw new Error("头像处理后仍然过大，请换一张图片");
  return result.src;
}

export async function compressImage(file: File, maxEdge = 1800, quality = 0.88) {
  let source: CanvasImageSource | null = null;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let bitmap: ImageBitmap | null = null;
  let fallbackSrc = "";

  if (typeof createImageBitmap === "function") {
    try {
      bitmap = await createImageBitmap(file);
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } catch {
      bitmap = null;
    }
  }

  if (!source) {
    fallbackSrc = await readAsDataUrl(file);
    const image = await loadImage(fallbackSrc);
    source = image;
    sourceWidth = image.naturalWidth;
    sourceHeight = image.naturalHeight;
  }

  const ratio = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap?.close();
    const src = fallbackSrc || await readAsDataUrl(file);
    return { src, width: sourceWidth, height: sourceHeight, mimeType: file.type, size: file.size };
  }
  context.drawImage(source, 0, 0, width, height);
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, mimeType, quality);
  bitmap?.close();
  if (!blob) {
    const src = fallbackSrc || await readAsDataUrl(file);
    return { src, width, height, mimeType: file.type, size: file.size };
  }
  const dataUrl = await readAsDataUrl(blob);
  return { src: dataUrl, width, height, mimeType: blob.type || mimeType, size: blob.size };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, body] = dataUrl.split(",");
  const mimeType = /data:(.*?);base64/.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export function downloadBlob(content: BlobPart | Blob, fileName: string, type = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
