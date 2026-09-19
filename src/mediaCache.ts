import { useEffect, useState } from "react";
import type { EventRecord, MediaAsset } from "./domain";

const CACHE_PREFIX = "live-memory-media-v3";
const LEGACY_CACHE_NAMES = ["live-memory-media-v2"];
const objectUrls = new Map<string, string>();
const pendingSources = new Map<string, Promise<string>>();
const decodedImages = new Map<string, Promise<HTMLImageElement | null>>();
const MEDIA_CACHE_SCOPE_EVENT = "live-memory:media-cache-scope";
let cleanupRegistered = false;
let mediaCacheScope = "anonymous";

function currentCacheName() {
  return `${CACHE_PREFIX}-${hashIdentity(mediaCacheScope || "anonymous")}`;
}

function resetObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  pendingSources.clear();
  decodedImages.clear();
}

export function setMediaCacheScope(scope: string) {
  const next = scope.trim() || "anonymous";
  if (mediaCacheScope === next) return;
  resetObjectUrls();
  mediaCacheScope = next;
  if (typeof caches !== "undefined") {
    for (const legacy of LEGACY_CACHE_NAMES) void caches.delete(legacy);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MEDIA_CACHE_SCOPE_EVENT));
}

function isInlineSource(src: string) {
  return src.startsWith("data:") || src.startsWith("blob:");
}

function mediaIdentity(asset: MediaAsset) {
  // Storage paths are immutable per media asset in Live Memory. Signed URLs and
  // sync timestamps can rotate without changing the underlying image, so the
  // persistent cache key must remain stable across views and cloud refreshes.
  if (asset.storagePath) return `storage:${asset.storagePath}`;
  if (asset.src && !isInlineSource(asset.src)) return `url:${asset.src}`;
  return "";
}

export function peekResolvedMediaSource(asset?: MediaAsset) {
  if (!asset) return "";
  if (asset.src && isInlineSource(asset.src)) return asset.src;
  const identity = mediaIdentity(asset);
  return identity ? objectUrls.get(identity) || "" : "";
}

function hashIdentity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheRequest(identity: string) {
  const base = typeof window === "undefined"
    ? "https://local.invalid/"
    : new URL(import.meta.env.BASE_URL || "/", window.location.origin).toString();
  return new Request(new URL(`__media-cache__/${hashIdentity(identity)}`, base).toString());
}

function registerCleanup() {
  if (cleanupRegistered || typeof window === "undefined") return;
  cleanupRegistered = true;
  window.addEventListener("pagehide", (event) => {
    // BFCache keeps the document alive. Revoking object URLs here would leave
    // restored views holding dead poster URLs and force a second decode/load.
    if ((event as PageTransitionEvent).persisted) return;
    resetObjectUrls();
  });
}

async function readCachedSource(identity: string) {
  if (typeof caches === "undefined") return "";
  const cache = await caches.open(currentCacheName());
  const response = await cache.match(cacheRequest(identity));
  if (!response) return "";
  const blob = await response.blob();
  if (!blob.size) return "";
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(identity, objectUrl);
  registerCleanup();
  return objectUrl;
}

async function persistInlineSource(asset: MediaAsset, identity: string) {
  if (!identity || typeof caches === "undefined" || !asset.src || !isInlineSource(asset.src)) return;
  try {
    const response = await fetch(asset.src);
    if (!response.ok) return;
    const blob = await response.blob();
    if (!blob.size) return;
    const cache = await caches.open(currentCacheName());
    await cache.put(cacheRequest(identity), new Response(blob, {
      headers: { "content-type": blob.type || asset.mimeType || "application/octet-stream" },
    }));
  } catch {
    // Inline rendering remains available even if persistent cache priming fails.
  }
}

async function fetchAndCache(asset: MediaAsset, identity: string) {
  if (!asset.src) return "";
  const response = await fetch(asset.src, {
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok || response.type === "opaque") throw new Error(`Image request failed: ${response.status}`);

  const cacheable = response.clone();
  const blob = await response.blob();
  if (!blob.size) throw new Error("Image response was empty");
  if (typeof caches !== "undefined") {
    const cache = await caches.open(currentCacheName());
    await cache.put(cacheRequest(identity), cacheable).catch(() => undefined);
  }
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(identity, objectUrl);
  registerCleanup();
  return objectUrl;
}

export async function resolveMediaSource(asset?: MediaAsset, allowNetwork = true): Promise<string> {
  if (!asset?.src && !asset?.storagePath) return "";
  if (asset.src && isInlineSource(asset.src)) {
    if (asset.storagePath) void persistInlineSource(asset, mediaIdentity(asset));
    return asset.src;
  }

  const identity = mediaIdentity(asset);
  if (!identity) return asset.src || "";
  const inMemory = objectUrls.get(identity);
  if (inMemory) return inMemory;
  const existing = pendingSources.get(identity);
  if (existing) return existing;

  const task = (async () => {
    const cached = await readCachedSource(identity).catch(() => "");
    if (cached) return cached;
    if (!allowNetwork || !asset.src) return "";
    try {
      return await fetchAndCache(asset, identity);
    } catch {
      return asset.src || "";
    }
  })().finally(() => pendingSources.delete(identity));

  pendingSources.set(identity, task);
  return task;
}

export function useCachedMediaSrc(asset?: MediaAsset) {
  const [src, setSrc] = useState(() => peekResolvedMediaSource(asset));

  useEffect(() => {
    let active = true;
    const resolve = () => {
      setSrc(peekResolvedMediaSource(asset));
      if (!asset) return;
      void resolveMediaSource(asset).then((next) => {
        if (active) setSrc(next);
      });
    };
    resolve();
    const onScopeChanged = () => resolve();
    window.addEventListener(MEDIA_CACHE_SCOPE_EVENT, onScopeChanged);
    return () => {
      active = false;
      window.removeEventListener(MEDIA_CACHE_SCOPE_EVENT, onScopeChanged);
    };
  }, [asset?.id, asset?.src, asset?.storagePath, asset?.updatedAt]);

  return src;
}

export function mediaPreloadPlan(limit = 80, constrained?: boolean) {
  const lowMemory = typeof navigator !== "undefined"
    && Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8) <= 4;
  const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 720px)").matches;
  const isConstrained = constrained ?? Boolean(lowMemory || narrow);
  return {
    limit: Math.min(limit, isConstrained ? 16 : limit),
    workers: isConstrained ? 2 : 4,
  };
}

export async function preloadPrimaryRecordMedia(records: EventRecord[], workers = 6) {
  const unique = new Map<string, MediaAsset>();
  for (const record of records) {
    const asset = record.media.find((item) => item.kind === "poster") || record.media[0];
    if (!asset) continue;
    const identity = mediaIdentity(asset) || `inline:${asset.id}:${asset.updatedAt || ""}`;
    if (!unique.has(identity)) unique.set(identity, asset);
  }

  const queue = Array.from(unique.values());
  let cursor = 0;
  const tasks = Array.from({ length: Math.min(Math.max(1, workers), queue.length) }, async () => {
    while (cursor < queue.length) {
      const asset = queue[cursor];
      cursor += 1;
      await loadMediaImage(asset).catch(() => null);
    }
  });
  await Promise.all(tasks);
}

export async function preloadRecordMedia(records: EventRecord[], limit = 80) {
  const plan = mediaPreloadPlan(limit);
  const unique = new Map<string, MediaAsset>();
  for (const record of records) {
    for (const asset of record.media) {
      const identity = mediaIdentity(asset);
      if (identity && !unique.has(identity)) unique.set(identity, asset);
      if (unique.size >= plan.limit) break;
    }
    if (unique.size >= plan.limit) break;
  }

  const queue = Array.from(unique.values());
  let cursor = 0;
  const workers = Array.from({ length: Math.min(plan.workers, queue.length) }, async () => {
    while (cursor < queue.length) {
      const asset = queue[cursor];
      cursor += 1;
      await resolveMediaSource(asset).catch(() => "");
    }
  });
  await Promise.all(workers);
}

export async function loadMediaImage(asset?: MediaAsset) {
  if (!asset) return null;
  const identity = mediaIdentity(asset) || `inline:${asset.id}:${asset.updatedAt || ""}`;
  const existing = decodedImages.get(identity);
  if (existing) return existing;

  const task = (async () => {
    const src = await resolveMediaSource(asset);
    if (!src) return null;
    return new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      if (!isInlineSource(src)) image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = async () => {
        try {
          await image.decode?.();
        } catch {
          // onload already proves the image is renderable.
        }
        resolve(image);
      };
      image.onerror = () => resolve(null);
      image.src = src;
    });
  })();
  decodedImages.set(identity, task);
  const image = await task;
  if (!image) decodedImages.delete(identity);
  return image;
}

export async function clearPersistentMediaCache() {
  resetObjectUrls();
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_NAMES.includes(key))
    .map((key) => caches.delete(key)));
}
