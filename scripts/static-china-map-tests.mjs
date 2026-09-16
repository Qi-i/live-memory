import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
const archiveCss = await readFile(new URL("../src/archive.css", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");

assert.match(archive, /china-static-map/);
assert.match(archive, /data-map-mode="static-china"/);
assert.match(archive, /中国固定足迹底图/);
assert.match(archive, /不可拖动缩放/);
assert.match(archive, /projectChinaCoordinate/);
assert.match(archive, /cityCoordinateFallbacks/);
assert.match(archive, /china-map-land/);
assert.match(archive, /chinaMapHainanCoordinates/);
assert.match(archive, /Natural Earth 1:110m/);
assert.match(archive, /不作为行政区划或边界表达/);
assert.match(archiveCss, /\.china-static-map/);
assert.match(archiveCss, /\.china-map-land/);
assert.doesNotMatch(archiveCss, /\.venue-map-art\s*\{[^}]*#101418/s);
assert.match(settings, /中国固定足迹图（无需 API）/);

console.log("Fixed China footprint map contracts passed.");
