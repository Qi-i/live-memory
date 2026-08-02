import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [appRoot, archiveCss, bannerCss, studio, studioCss, main, visualAudit] = await Promise.all([
  readFile("src/AppRoot.tsx", "utf8"),
  readFile("src/archive.css", "utf8"),
  readFile("src/archiveBanner.css", "utf8"),
  readFile("src/shareStudio.tsx", "utf8"),
  readFile("src/shareStudio.css", "utf8"),
  readFile("src/main.tsx", "utf8"),
  readFile("scripts/visual-audit.mjs", "utf8"),
]);

assert.match(appRoot, /useState<ShareFormat>\("portrait"\)/, "Share studio should open in portrait format");
assert.match(bannerCss, /content:\s*"把现场，留在时间里"/);
assert.match(bannerCss, /white-space:\s*nowrap/);
assert.match(bannerCss, /archive-highlight-card-4,[\s\S]*display:\s*none/);
assert.match(studio, /function partitionBalanced/);
assert.match(studio, /occupiedArea/);
assert.match(studio, /function buildAdaptiveMagazineRows/);
assert.match(studio, /spec\.format === "landscape"/);
assert.match(studio, /const topCount = records\.length >= 14 \? 6/);
assert.match(studio, /fill \* 0\.4 \+ verticalUse \* 0\.25 \+ scale \* 0\.3/);
assert.doesNotMatch(studio, /const scaledWidth = area\.width \* scale/, "Magazine must not collapse the whole composition into a narrow centered strip");
assert.match(archiveCss, /archive-wallet-grid[\s\S]*minmax\(560px, 1fr\)/);
assert.match(bannerCss, /archive-wallet-grid[\s\S]*minmax\(540px, 1fr\)/);
assert.match(studio, /useLayoutEffect\(\(\) => \{[\s\S]*setManualScale\(null\);[\s\S]*recalculateFit\(\);/, "Format changes must fit the preview before paint");
assert.match(studio, /ResizeObserver/);
assert.match(studio, /drawContain/);
assert.doesNotMatch(studio, /function centerSlots/, "Unused layout helpers must not remain in production code");
assert.match(studioCss, /share-preview-area\.is-long \{ overflow-x:\s*hidden; overflow-y:\s*auto;/);
assert.match(studioCss, /share-poster-foreground,[\s\S]*object-fit:\s*contain/);
assert.match(visualAudit, /hasText:\s*"竖版 4:5"/);
assert.match(visualAudit, /viewportRect\.bottom <= areaRect\.bottom \+ 2/);
assert.match(visualAudit, /Mobile share wall/);
assert.doesNotMatch(main, /shareStudioRefinement\.css/);

console.log("V5 layout contracts passed.");
