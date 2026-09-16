import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const share = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");
const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
const archiveCss = await readFile(new URL("../src/archive.css", import.meta.url), "utf8");
const appRoot = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/appController.ts", import.meta.url), "utf8");

assert.match(share, /type ShareLayout = [^;]*"tickets"/);
assert.match(share, /useState<ItemLimit>\("all"\)/);
assert.match(share, /value:\s*"tickets"/);
assert.match(share, /share-ticket-grid/);
assert.match(share, /drawTicket/i);

assert.match(archive, /archive-ticket-backdrop/);
assert.match(archiveCss, /\.archive-ticket-backdrop/);
assert.match(archiveCss, /filter:\s*blur\(/);
assert.match(archiveCss, /backdrop-filter:\s*blur\(/);
assert.doesNotMatch(archive, /showcase-card-\$\{index % 7\}/);
assert.match(archiveCss, /column-width|columns:/);

assert.match(controller, /async function syncNow|const syncNow\s*=/);
assert.match(controller, /async function checkRemoteUpdates|const checkRemoteUpdates\s*=/);
assert.match(controller, /async function refreshCloudMedia|const refreshCloudMedia\s*=/);
assert.match(appRoot, /检查其他设备更新/);
assert.match(appRoot, /刷新云端图片/);
assert.match(appRoot, /立即同步/);

assert.match(archive, /mapSettings/);
assert.match(archive, /provider === "amap"/);
assert.match(archive, /amap-map-host/);
assert.match(archive, /配置高德 Key/);
assert.match(archive, /百度地图尚未接入/);
assert.doesNotMatch(archive, /china-map-land/);

console.log("Archive experience redesign contracts passed.");
