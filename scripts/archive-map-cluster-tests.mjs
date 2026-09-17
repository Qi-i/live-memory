import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
const amap = await readFile(new URL("../src/amap.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../src/archive.css", import.meta.url), "utf8");

assert.match(archive, /buildPlaceGroups/, "Archive map must aggregate records into place groups");
assert.match(archive, /heat:\s*count\s*\/\s*maxCount|heat\s*=\s*count\s*\/\s*maxCount/, "Place groups must expose normalized heat");
assert.match(archive, /selectedPlaceKey/, "Map and ranking must share selected place state");
assert.match(archive, /hoveredPlaceKey/, "Map and ranking must share hover state");
assert.match(archive, /venue-place-picker/, "First place click must open a place picker");
assert.match(archive, /amap-poster-marker/, "AMap markers must render poster-stack content");
assert.match(archive, /content:\s*markerContent|content:\s*build/, "AMap marker must use custom HTML content");
assert.doesNotMatch(archive, /marker\.on\?\("click",\s*\(\)\s*=>\s*onOpen\(record\)\)/, "Map marker click must not directly open record detail");
assert.match(archive, /onMouseEnter=.*setHoveredPlaceKey|setHoveredPlaceKey\(/, "Ranking hover must update shared map highlight");
assert.match(archive, /focusPlace|setZoomAndCenter|setCenter/, "Ranking click must focus the map place");
assert.match(amap, /content\??:/, "AMap wrapper types must support custom marker content");
assert.match(css, /\.amap-poster-marker/, "Poster markers require dedicated styling");
assert.match(css, /\.venue-place-picker/, "Place picker requires dedicated styling");
assert.match(css, /venue-heat-legend|map-heat-legend/, "Map must explain low-to-high visit heat");

console.log("Archive map cluster contracts passed.");
