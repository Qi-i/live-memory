import { useEffect, useState } from "react";
import type { EventRecord, MediaAsset } from "./domain";

const CACHE_PREFIX = "live-memory-media-v3";
const LEGACY_CACHE_NAMES = ["live-memory-media-v2"];
const objectUrls = new Map<string, string>();
const pendingSources = new Map<string, Promise<string>>();
let cleanupRegistered = false;
let mediaCacheScope = "anonymous";

function currentCacheName() {
  return `${CACHE_PREFIX}-${hashIdentity(mediaCacheScope || "anonymous")}`;
}

function resetObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  pendingSources.clear();
}

export function setMediaCacheScope(scope: string) {
  const next = scope.trim() || "anonymous";
  if (mediaCacheScope === next) return;
  resetObjectUrls();
  mediaCacheScope = next;
  if (typeof caches !== "undefined") {
    for (const legacy of LEGACY_CACHE_NAMES) void caches.delete(legacy);
  }
}

function isInlineSource(src: string) {
  return src.startsWith("data:") || src.startsWith("blob:");
}

function mediaIdentity(asset: MediaAsset) {
  if (asset.storagePath) return `storage:${asset.storagePath}:${asset.updatedAt || ""}`;
  if (asset.src && !isInlineSource(asset.src)) return `url:${asset.src}`;
  return "";
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
  window.addEventListener("pagehide", () => {
    resetObjectUrls();
  }, { once: true });
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
  if (asset.src && isInlineSource(asset.src)) return asset.src;

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
  const inline = asset?.src && isInlineSource(asset.src) ? asset.src : "";
  const [src, setSrc] = useState(inline);

  useEffect(() => {
    let active = true;
    setSrc(asset?.src && isInlineSource(asset.src) ? asset.src : "");
    if (!asset) return () => { active = false; };
    void resolveMediaSource(asset).then((next) => {
      if (active) setSrc(next);
    });
    return () => { active = false; };
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
  const src = await resolveMediaSource(asset);
  if (!src) return null;
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    if (!isInlineSource(src)) image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export async function clearPersistentMediaCache() {
  resetObjectUrls();
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_NAMES.includes(key))
    .map((key) => caches.delete(key)));
}
