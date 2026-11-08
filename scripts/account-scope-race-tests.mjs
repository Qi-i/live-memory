import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(new URL("../src/appController.ts", import.meta.url), "utf8");
const root = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");

assert.match(controller, /currentStorageScope/);
assert.match(controller, /activeControllerScope\.current !== sessionScope/);
assert.match(controller, /setSelected\(null\);[\s\S]*setEditing\(null\);[\s\S]*setZoomMedia\(null\);[\s\S]*setSyncConflicts\(\[\]\);/, "Account switch must hide prior account detail and edit state");
assert.match(controller, /syncOperationInFlight\.current = false;[\s\S]*lastSyncFingerprint\.current = "";/, "Account hydration must invalidate stale sync state");
assert.match(root, /key=\{access\.user\?\.id \|\| \(isGuest \? "guest" : "local"\)\}/, "Archive only remounts on identity change, not media changes");
assert.doesNotMatch(root, /archiveMediaKey|key=\{[^}]*\.media/, "Rotating images must not remount the archive");

const init = controller.slice(controller.indexOf("useEffect(() => {\n    let active = true;"), controller.indexOf("const activeRecords"));
assert.match(init, /currentStorageScope\(\) !== sessionScope/, "Initial restoration must guard account context");
assert.match(init, /await replaceAllRecords\(nextRecords\);[\s\S]*currentStorageScope\(\) !== sessionScope/, "Initial restore must fence state updates after persistence");

const recovery = controller.slice(controller.indexOf("async function recoverPersonalCloud"), controller.indexOf("useEffect(() => {\n    if (isGuest || !access.user || settings.storageMode"));
assert.match(recovery, /currentStorageScope\(\) !== recoveryScope/, "Personal cloud reconnect must refuse stale results");

const autosync = controller.slice(controller.indexOf("const fingerprint = autoSyncFingerprint"), controller.indexOf("const pageViewEnabled"));
assert.match(autosync, /const syncScope = currentStorageScope\(\)/, "Background sync must bind the initiating identity");
assert.match(autosync, /\.then\(async \(result\) => \{\s*if \(currentStorageScope\(\) !== syncScope\) return;/, "Background sync must fence stale cloud responses");
assert.match(autosync, /const mediaScope = currentStorageScope\(\)/, "Media refresh must bind the initiating identity");
assert.match(autosync, /cancelled \|\| currentStorageScope\(\) !== mediaScope/, "Background media refresh must reject stale results");

const manual = controller.slice(controller.indexOf("async function runCloudSync"), controller.indexOf("async function persistRecord"));
assert.match(manual, /const syncScope = currentStorageScope\(\)/);
assert.match(manual, /if \(currentStorageScope\(\) !== syncScope\) return false;/);
assert.match(manual, /const refreshScope = currentStorageScope\(\)/);
assert.match(manual, /if \(currentStorageScope\(\) !== refreshScope\) return false;/);

console.log("Live Memory account-scoped hydration, auto/manual sync, media refresh, and view reset contracts passed.");
