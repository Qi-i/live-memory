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

export async function compressImage(file: File, maxEdge = 1800, quality = 0.88) {
  const src = await readAsDataUrl(file);
  const image = await loadImage(src);
  const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * ratio);
  const height = Math.round(image.naturalHeight * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return { src, width: image.naturalWidth, height: image.naturalHeight, mimeType: file.type, size: file.size };
  }
  context.drawImage(image, 0, 0, width, height);
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return { src: dataUrl, width, height, mimeType, size: Math.round((dataUrl.length * 3) / 4) };
}

export function readAsDataUrl(file: File): Promise<string> {
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
