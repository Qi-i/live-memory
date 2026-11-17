import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shareStudio = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");
const shareCss = await readFile(new URL("../src/shareStudio.css", import.meta.url), "utf8");
const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
const amap = await readFile(new URL("../src/amap.ts", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");
const supabase = await readFile(new URL("../src/supabase.ts", import.meta.url), "utf8");

assert.match(shareStudio, /adaptive-landscape/);
assert.match(shareStudio, /adaptive-portrait/);
assert.match(shareStudio, /智能横版/);
assert.match(shareStudio, /智能竖版/);
for (const label of ["横版 4:3", "横版 16:9", "竖版 3:4", "竖版 9:16"]) assert.match(shareStudio, new RegExp(label));
assert.match(shareStudio, /function getAdaptiveCanvasSpec/);
assert.match(shareStudio, /function contentResolutionScale/);
assert.match(shareStudio, /function buildWallFillSlots/);
assert.match(shareStudio, /SHARE_POSTER_MAX_FRAME_ASPECT\s*=\s*0\.86/);
assert.match(shareStudio, /function fitPosterRowRatios/);
assert.match(shareStudio, /preloadPrimaryRecordMedia\(selectedRecords, 6, true\)/);
assert.match(shareStudio, /is-poster-preserved/);
assert.match(shareStudio, /partitionByAspect/);
assert.match(shareStudio, /function buildFilledGridRects/);
assert.match(shareStudio, /function orderMagazineRecords/);
assert.match(shareStudio, /function buildWeightedMosaic/);
assert.match(shareStudio, /function assignMagazineRectsByAspect/);
assert.match(shareStudio, /rectRatio \/ posterRatio/);
assert.match(shareStudio, /featuredIds/);
assert.match(shareStudio, /function ShareAmapMap/);
assert.match(shareStudio, /shareCityFingerprint/);
assert.match(shareStudio, /shareCityPositionCache/);
assert.match(shareStudio, /resolveShareMapPoints/);
assert.match(shareStudio, /AMap\.Geocoder|Geocoder/);
assert.match(shareStudio, /SHARE_CHINA_MAP_CENTER/);
assert.match(shareStudio, /SHARE_CHINA_BOUNDS/);
assert.match(shareStudio, /function chinaViewportZoom/);
assert.match(shareStudio, /zoom:\s*chinaViewportZoom\(host\)/);
assert.match(shareStudio, /zoomEnable:\s*false/);
assert.match(shareStudio, /dragEnable:\s*false/);
assert.match(shareStudio, /scrollWheel:\s*false/);
assert.match(shareStudio, /doubleClickZoom:\s*false/);
assert.match(shareStudio, /resizeEnable:\s*false/);
assert.match(shareStudio, /geocodeAmapPlace\(geocoder, city\.label\)/);
assert.doesNotMatch(shareStudio, /map\.setFitView/);
assert.match(shareStudio, /const configured = Boolean\(mapSettings\.amapKey\.trim\(\)\)/);
assert.doesNotMatch(shareStudio, /mapSettings\.provider !== "amap"/);
assert.doesNotMatch(shareStudio, /cities\.values\(\)\)\.slice\(/);
assert.match(amap, /plugin\?:/);
assert.match(amap, /Geocoder\?:/);
assert.match(archive, /mapSettings=\{settings\.map\}/);
assert.match(supabase, /amap_key:\s*settings\.map\.amapKey/);
assert.match(supabase, /amapSecurityCode:\s*settings\.map\.amapSecurityCode/);
assert.match(supabase, /amapKey:\s*mapPreferences\.amapKey\s*\|\|\s*profile\.amapKey/);
assert.doesNotMatch(shareStudio, /cityCoordinateFallbacks|function cityCoordinate|非地图示意/);
assert.doesNotMatch(shareCss, /share-coordinate-field|share-city-bands/);
assert.match(shareCss, /share-amap-panel/);
assert.match(shareCss, /--ticket-title-size/);
assert.match(shareCss, /share-control-compact-grid/);
assert.match(shareCss, /object-fit:\s*cover/);
assert.match(shareCss, /share-poster-foreground[^}]*transform:\s*scale\(1\.025\)/s);
assert.match(shareCss, /share-poster-frame\.is-preserved[\s\S]*object-fit:\s*contain/s);
assert.match(shareCss, /share-poster-backdrop/);
assert.match(settings, /离线城市摘要（无需 API）/);
assert.match(settings, /全国城市分享图会直接复用个人账号中已保存的高德 Web JS API Key/);
assert.match(settings, /lbs\.amap\.com/);
assert.match(settings, /地图 API 获取说明|获取高德 Key/);

assert.match(shareStudio,/experience==="v3" && !allowMissingPosters/);
assert.match(shareStudio,/await loadMediaImage\(asset\)/,
  "PNG must check actual canvas-safe decoded media instead of trusting URL references");
assert.match(shareStudio,/有 \${unavailable} 张海报无法取得可导出的原图/);
assert.match(shareStudio,/checked=\{allowMissingPosters\}/);
assert.match(shareStudio,/允许海报占位色块/);
const v3ShareCss=await readFile(new URL("../src/ui/real/v3ShareStudio.css",import.meta.url),"utf8");
assert.match(v3ShareCss,/\.share-v3-allow-missing/);

assert.match(shareStudio,/posterDisplayMode\(naturalRatio, frameRatio\)/,
  "Exported poster crop must use actual decoded image dimensions");
assert.match(shareStudio,/posterDisplayMode\(sourceRatio, targetRatio\)/,
  "Ticket-album PNG must preserve extreme vertical posters");
assert.match(shareStudio,/useState\(false\);\s*const \[preparing/,
  "Clean screenshot mode remains a separate presentation state");
assert.match(shareStudio,/aria-label="纯净全屏预览"/,
  "V3 share studio must allow a screenshot-friendly fullscreen preview");
assert.match(v3ShareCss,/\.share-studio-stage\.is-v3\.is-preview-clean/,
  "Fullscreen preview must be styled on desktop and mobile");
assert.match(shareStudio,/\[posterPreloadKey\]/,
  "Metadata-only changes must not warm the same signed poster twice");

console.log("Share layout engine contracts passed: ratio-preserving canvases, edge-filled walls, readable tickets, artist-aware magazine mosaics, and a fixed nationwide AMap extent across aspect ratios.");
