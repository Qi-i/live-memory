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
assert.match(controller, /recoverPersonalCloud/, "Controller must expose a retryable personal cloud recovery action");
assert.match(controller, /restorePersonalCloudMedia|pullRecordsFromSupabase/, "Controller retry must be able to restore missing media references from personal cloud");
assert.match(controller, /addEventListener\("focus"[\s\S]*recoverPersonalCloud|recoverPersonalCloud[\s\S]*addEventListener\("focus"/, "Focus recovery path must retry personal cloud reconnect");
assert.match(controller, /addEventListener\("online"[\s\S]*recoverPersonalCloud|recoverPersonalCloud[\s\S]*addEventListener\("online"/, "Online recovery path must retry personal cloud reconnect");
assert.match(appRoot, /个人云端.*恢复|恢复个人云端|个人云端需恢复/, "Cloud center must surface personal cloud recovery state");
assert.match(appRoot, /AccountStatus[\s\S]*personalCloudStatus[\s\S]*个人云端需恢复/, "Account chip must not claim cloud is connected while personal media recovery is pending");

console.log("Personal cloud reconnect contracts passed.");
