import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [appRoot, bannerCss, studio, studioCss, main, visualAudit] = await Promise.all([
  readFile("src/AppRoot.tsx", "utf8"),
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
assert.match(studio, /records\.length <= 8 \? 3 : records\.length <= 24 \? 4 : 5/);
assert.match(studio, /const compactMagazine = records\.length <= 8;/);
assert.match(studio, /index === 0 \? Math\.min\(compactMagazine \? 2 : 3, columns\)/, "Compact magazine sets should use a two-column hero and one-column supporting posters");
assert.match(studio, /ResizeObserver/);
assert.match(studio, /drawContain/);
assert.doesNotMatch(studio, /function centerSlots/, "Unused layout helpers must not remain in production code");
assert.match(studioCss, /share-preview-area\.is-long \{ overflow-x:\s*hidden; overflow-y:\s*auto;/);
assert.match(studioCss, /share-poster-foreground,[\s\S]*object-fit:\s*contain/);
assert.match(visualAudit, /hasText:\s*"竖版 4:5"/);
assert.match(visualAudit, /Mobile share wall/);
assert.doesNotMatch(main, /shareStudioRefinement\.css/);

console.log("V5 layout contracts passed.");
