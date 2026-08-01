import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

await patch("src/archive.tsx", (source) => source
  .replace(
    '  const [density, setDensity] = useState(settings.posterColumns || 4);',
    '  const preferredPosterColumns = Math.min(8, Math.max(4, settings.posterColumns || 5));\n  const [density, setDensity] = useState(preferredPosterColumns);',
  )
  .replace(
    '{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 列</option>)}',
    '{[4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} 列</option>)}',
  ));

await patch("src/experience.tsx", (source) => source
  .replace('<span><b>清透</b><small>留白更轻，适合日常浏览</small></span>', '<span><b>清透玻璃</b><small>柔和渐变、圆角玻璃与轻盈留白</small></span>')
  .replace('<span><b>画册</b><small>排版更突出，适合截图分享</small></span>', '<span><b>纸质画册</b><small>纸张底色、硬边框与杂志式排版</small></span>'));

await patch("scripts/visual-audit.mjs", (source) => source.replace(
  '  await page.screenshot({ path: `${outputDir}/02-archive-poster-desktop.png`, fullPage: true });',
  '  const posterTops = await page.locator(".archive-poster-card").evaluateAll((cards) => cards.slice(0, 10).map((card) => Math.round(card.getBoundingClientRect().top)));\n  const firstRowCount = posterTops.filter((top) => Math.abs(top - posterTops[0]) <= 3).length;\n  if (firstRowCount < 4) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);\n  await page.screenshot({ path: `${outputDir}/02-archive-poster-desktop.png`, fullPage: true });',
));
