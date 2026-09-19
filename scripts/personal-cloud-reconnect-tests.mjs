import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const supabase = await readFile(new URL("../src/supabase.ts", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/appController.ts", import.meta.url), "utf8");
const appRoot = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");

assert.match(supabase, /personalCloudStatus|personalCloudRecovery/, "Post-login sync must expose personal cloud recovery status");
assert.match(supabase, /signInStorageWithAccount\(nextSettings\)/, "Saved personal cloud must reconnect after login");
assert.match(supabase, /restorePersonalCloudMedia|pullRecordsFromSupabase\(nextSettings/, "New-device recovery must pull the personal cloud media catalog, not only renew URLs already present locally");
assert.match(supabase, /refreshSignedMediaUrls\((?:settings|nextSettings|connected\.settings)/, "Successful reconnect must immediately refresh signed media URLs after restoring the media catalog");
assert.match(supabase, /mergePersonalCloudMedia/, "Personal cloud media recovery must merge media references without blindly replacing newer text data");
assert.match(supabase, /pullRecordsFromPasskeySupabase\(settings, \[\], false\)/, "Startup media restore should pull descriptors without issuing per-asset signed URL requests");
assert.match(supabase, /refreshSignedMediaUrls\(settings, merged\)/, "Startup media restore should batch only the cloud URLs that are actually missing");
assert.doesNotMatch(supabase, /refreshSignedMediaUrls\(settings, merged, \{ force: true \}\)/, "Startup must not force-renew every signed media URL");
assert.match(controller, /recoverPersonalCloud/, "Controller must expose a retryable personal cloud recovery action");
assert.match(controller, /restorePersonalCloudMedia|pullRecordsFromSupabase/, "Controller retry must be able to restore missing media references from personal cloud");
assert.doesNotMatch(controller, /addEventListener\("focus"/, "Foregrounding the page must not trigger personal cloud recovery or repaint the archive/map");
assert.match(controller, /setInterval\(retryPersonalCloud,\s*60_000\)/, "Personal cloud reconnect must keep a bounded timer retry without relying on focus");
assert.match(controller, /addEventListener\("online"[\s\S]*recoverPersonalCloud|recoverPersonalCloud[\s\S]*addEventListener\("online"/, "Online recovery path must retry personal cloud reconnect");
assert.match(appRoot, /个人云端.*恢复|恢复个人云端|个人云端需恢复/, "Cloud center must surface personal cloud recovery state");
assert.match(appRoot, /AccountStatus[\s\S]*personalCloudStatus[\s\S]*个人云端需恢复/, "Account chip must not claim cloud is connected while personal media recovery is pending");

console.log("Personal cloud reconnect contracts passed.");
