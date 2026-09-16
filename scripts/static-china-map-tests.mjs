import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
const archiveCss = await readFile(new URL("../src/archive.css", import.meta.url), "utf8");
const amap = await readFile(new URL("../src/amap.ts", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");

assert.match(archive, /mapSettings/);
assert.match(archive, /provider === "amap"/);
assert.match(archive, /data-map-mode="amap-missing-key"/);
assert.match(archive, /data-map-mode="baidu-not-ready"/);
assert.match(archive, /data-map-mode="offline-summary"/);
assert.match(archive, /amap-map-host/);
assert.doesNotMatch(archive, /china-map-land|chinaOutlineCoordinates|projectChinaCoordinate/);
assert.match(amap, /webapi\.amap\.com\/maps\?v=2\.0/);
assert.match(amap, /_AMapSecurityConfig/);
assert.match(amap, /data-live-memory-amap/);
assert.match(archiveCss, /\.amap-map-host/);
assert.match(settings, /离线城市摘要（无需 API）/);

console.log("Provider-driven archive map contracts passed.");
