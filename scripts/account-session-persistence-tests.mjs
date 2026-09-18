import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const supabase = await readFile(new URL("../src/supabase.ts", import.meta.url), "utf8");
const adminApi = await readFile(new URL("../src/adminApi.ts", import.meta.url), "utf8");
const access = await readFile(new URL("../src/access.tsx", import.meta.url), "utf8");
const storage = await readFile(new URL("../src/storage.ts", import.meta.url), "utf8");
const mediaCache = await readFile(new URL("../src/mediaCache.ts", import.meta.url), "utf8");

const sessionKey = "live-memory-account-session";
const occurrences = [supabase, adminApi].reduce((count, source) => count + source.split(sessionKey).length - 1, 0);

assert.equal(occurrences, 1, "Only the shared account auth client may own the persisted session storage key");
assert.doesNotMatch(adminApi, /createClient\s*\(/, "Admin API must not create a second Supabase auth client");
assert.match(supabase, /export function getAccountClient\(\)/);
assert.match(adminApi, /import\s*\{\s*getAccountClient\s*\}\s*from\s*["']\.\/supabase["']/);
assert.match(adminApi, /getAccountClient\(\)/, "Admin API must reuse the shared account client");
assert.match(supabase, /persistSession:\s*true/);
assert.match(supabase, /autoRefreshToken:\s*true/);
assert.match(access, /currentUser\(readSettings\(\)\)/);
assert.match(access, /watchAccountAuth/);
assert.match(access, /activateSessionStorage/);
assert.match(access, /setStorageScope\(user\.id/);
assert.match(access, /clearPersistentMediaCache/);
assert.match(storage, /storageScopeKey\(DB_NAME\)/, "IndexedDB must be account-scoped");
assert.match(storage, /storageScopeKey\(SETTINGS_KEY\)/, "Settings must be account-scoped");
assert.match(storage, /storageScopeKey\(FALLBACK_RECORDS_KEY\)/, "Fallback records must be account-scoped");
assert.match(storage, /UNSCOPED_OWNER_KEY/, "Legacy unscoped data must have a single migration owner");
assert.match(mediaCache, /CACHE_PREFIX = "live-memory-media-v3"/);
assert.match(mediaCache, /setMediaCacheScope/);
assert.match(mediaCache, /key\.startsWith\(CACHE_PREFIX\)/, "Sign-out cleanup must remove persistent private media caches");

console.log("Account session persistence and local account-isolation contracts passed.");
