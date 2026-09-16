import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const supabase = await readFile(new URL("../src/supabase.ts", import.meta.url), "utf8");
const adminApi = await readFile(new URL("../src/adminApi.ts", import.meta.url), "utf8");
const access = await readFile(new URL("../src/access.tsx", import.meta.url), "utf8");

const sessionKey = "live-memory-account-session";
const occurrences = [supabase, adminApi].reduce((count, source) => count + source.split(sessionKey).length - 1, 0);

assert.equal(occurrences, 1, "Only the shared account auth client may own the persisted session storage key");
assert.doesNotMatch(adminApi, /createClient\s*\(/, "Admin API must not create a second Supabase auth client");
assert.match(adminApi, /getAccountClient|invokeAccountFunction|accountClient/, "Admin API must reuse the shared account client");
assert.match(supabase, /persistSession:\s*true/);
assert.match(supabase, /autoRefreshToken:\s*true/);
assert.match(access, /currentUser\(readSettings\(\)\)/);
assert.match(access, /watchAccountAuth/);

console.log("Account session persistence contracts passed.");
