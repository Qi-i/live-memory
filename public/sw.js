const CACHE_NAME = "live-memory-v6";
const APP_CACHE_PREFIX = "live-memory-v";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./live-memory-mark.svg", "./live-memory-logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(APP_CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // The independent V3 demo is not an offline production app. Never let the
  // V2 service worker cache or serve stale prototype HTML and assets.
  const previewPath = new URL("v3-preview/", self.registration.scope).pathname;
  if (sameOrigin && url.pathname.startsWith(previewPath)) return;
  const migrationPath = new URL("v3-migration/", self.registration.scope).pathname;
  if (sameOrigin && url.pathname.startsWith(migrationPath)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  if (request.destination === "image" && /(^|\.)alicdn\.com$/i.test(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match("./index.html"));
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    // Keep the worker alive until the refreshed asset is persisted.
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") await cache.put(request, response.clone()).catch(() => undefined);
  return response;
}
