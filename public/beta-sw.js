// Passive service worker scoped to /live-memory/v3-beta/.
// The production V2 worker owns the broader /live-memory/ scope. This
// narrower registration prevents V2 offline HTML/cache fallbacks from
// taking control of beta pages without altering V2 or caching user data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
// Deliberately no fetch handler and no cache operations.
