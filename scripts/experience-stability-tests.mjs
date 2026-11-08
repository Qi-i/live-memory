import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const text = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [appRoot, archive, banner, controller, mediaCache, shell, css] = await Promise.all([
  "src/AppRoot.tsx", "src/archive.tsx", "src/archiveBanner.css",
  "src/appController.ts", "src/mediaCache.ts", "src/experience.tsx",
  "src/experience.css",
].map(text));

assert.doesNotMatch(appRoot, /key=\{archiveMediaKey\}/, "Media changes must not remount the entire archive");
assert.doesNotMatch(appRoot, /const archiveMediaKey\s*=/, "Do not rebuild giant key strings from all images");
assert.match(archive, /<h2>把现场，留在时间里<\/h2>/, "The visible archive heading must be real accessible text");
assert.doesNotMatch(banner, /\.archive-page \.archive-masthead h2::before/, "Do not substitute real headings with CSS content");
assert.match(controller, /\[access\.user\?\.id, pageViewEnabled, route\]/, "Non-navigation settings writes must not trigger page-view telemetry");
assert.match(shell, /aria-expanded=\{mobileNavOpen\}/);
assert.match(shell, /experience-nav-scrim/);
assert.match(css, /\.experience-nav-scrim/);
assert.match(mediaCache, /mediaCacheEpoch/, "Account-scoped caches must fence stale work");

const server = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});
const originals = {
  fetch: globalThis.fetch,
  caches: globalThis.caches,
  window: globalThis.window,
};
try {
  const media = await server.ssrLoadModule("/src/mediaCache.ts");
  const eventTarget = new EventTarget();
  globalThis.window = {
    location: { origin: "https://example.test" },
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  };

  const stores = new Map();
  globalThis.caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (request) => store.get(request.url),
        put: async (request, response) => { store.set(request.url, response.clone()); },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };

  let releaseOld;
  let releaseNew;
  let startedOld;
  let startedNew;
  const oldStarted = new Promise((resolve) => { startedOld = resolve; });
  const newStarted = new Promise((resolve) => { startedNew = resolve; });
  const oldResponse = new Promise((resolve) => { releaseOld = resolve; });
  const newResponse = new Promise((resolve) => { releaseNew = resolve; });
  let newFetchCount = 0;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("/old.jpg")) { startedOld(); return oldResponse; }
    if (url.includes("/new.jpg")) { newFetchCount++; startedNew(); return newResponse; }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const shared = { id: "same", storagePath: "shared/poster.jpg", mimeType: "image/jpeg" };
  const oldAsset = { ...shared, src: "https://images.test/old.jpg" };
  const newAsset = { ...shared, src: "https://images.test/new.jpg" };
  media.setMediaCacheScope("account-a");
  const oldTask = media.resolveMediaSource(oldAsset);
  await oldStarted;

  media.setMediaCacheScope("account-b");
  const newTask = media.resolveMediaSource(newAsset);
  await newStarted;

  releaseOld(new Response(new Blob(["OLD"], { type: "image/jpeg" }), { status: 200 }));
  assert.equal(await oldTask, "", "An old account's late response must be ignored");

  const duplicateNewTask = media.resolveMediaSource(newAsset);
  await Promise.resolve();
  assert.equal(newFetchCount, 1, "The old task must not evict a new account's pending request");

  releaseNew(new Response(new Blob(["NEW"], { type: "image/jpeg" }), { status: 200 }));
  const newUrl = await newTask;
  assert.ok(newUrl.startsWith("blob:"), "The new account's poster should resolve");
  assert.equal(await duplicateNewTask, newUrl);
  assert.equal(media.peekResolvedMediaSource(newAsset), newUrl);
  assert.equal(stores.size, 2, "Account caches remain isolated");
  media.setMediaCacheScope("test-cleanup");
  assert.equal(media.peekResolvedMediaSource(newAsset), "");
} finally {
  globalThis.fetch = originals.fetch;
  globalThis.caches = originals.caches;
  globalThis.window = originals.window;
  await server.close();
}

console.log("Archive state, responsive navigation, telemetry and cross-account media cache race contracts passed.");
