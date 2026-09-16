import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shareStudio = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");
const shareCss = await readFile(new URL("../src/shareStudio.css", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");

assert.match(shareStudio, /adaptive-landscape/);
assert.match(shareStudio, /adaptive-portrait/);
assert.match(shareStudio, /智能横版/);
assert.match(shareStudio, /智能竖版/);
assert.match(shareStudio, /function getAdaptiveCanvasSpec/);
assert.match(shareStudio, /function buildAdaptiveWallSlots/);
assert.match(shareStudio, /function buildSmallMagazineSlots/);
assert.match(shareStudio, /wallFill|fillRatio|occupiedRatio/);
assert.match(shareStudio, /Math\.round\(width \* 0\.425\)/);
assert.match(shareStudio, /Math\.round\(width \* 1\.12\)/);
assert.match(shareStudio, /graphite/);
assert.match(shareStudio, /mist/);
assert.match(shareStudio, /forest/);
assert.match(shareStudio, /champagne/);
assert.match(shareStudio, /plum/);
assert.match(shareStudio, /silver/);
assert.match(shareCss, /share-control-compact-grid/);
assert.match(shareCss, /object-fit:\s*cover/);
assert.match(shareCss, /share-poster-foreground[^}]*transform:\s*scale\(1\.025\)/s);
assert.match(settings, /中国固定足迹图（无需 API）/);
assert.match(settings, /lbs\.amap\.com/);
assert.match(settings, /lbsyun\.baidu\.com/);
assert.match(settings, /地图 API 获取说明|获取高德 Key|获取百度 AK/);
assert.match(settings, /target="_blank"/);

console.log("Adaptive share studio, compact controls, palettes, and map API guidance contracts passed.");
