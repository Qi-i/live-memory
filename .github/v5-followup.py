from pathlib import Path
import re

app = Path("src/AppRoot.tsx")
text = app.read_text()
text = text.replace('useState<ShareFormat>("landscape")', 'useState<ShareFormat>("portrait")')
app.write_text(text)

banner = Path("src/archiveBanner.css")
text = banner.read_text()
text = text.replace(
    '  font-size: clamp(42px, 4.1vw, 64px);\n  font-weight: 970;\n  line-height: .98;\n  letter-spacing: -.07em;',
    '  font-size: clamp(34px, 3.6vw, 54px);\n  font-weight: 970;\n  line-height: .98;\n  letter-spacing: -.08em;\n  white-space: nowrap;',
)
text = text.replace(
    '  top: 5%;\n  left: 37%;\n  z-index: 7;\n  width: 30%;\n  height: 84%;',
    '  top: 5%;\n  left: 35%;\n  z-index: 7;\n  width: 30%;\n  height: 84%;',
)
text = text.replace(
    '  top: 19%;\n  left: 8%;\n  z-index: 4;\n  width: 27%;\n  height: 65%;',
    '  top: 18%;\n  left: 2%;\n  z-index: 4;\n  width: 30%;\n  height: 68%;',
)
text = text.replace(
    '  top: 17%;\n  right: 4%;\n  left: auto;\n  z-index: 5;\n  width: 27%;\n  height: 68%;',
    '  top: 17%;\n  right: 2%;\n  left: auto;\n  z-index: 5;\n  width: 30%;\n  height: 70%;',
)
text = text.replace(
    '.archive-page .archive-highlight-card-5,\n.archive-page .archive-highlight-card-6 { display: none; }',
    '.archive-page .archive-highlight-card-4,\n.archive-page .archive-highlight-card-5,\n.archive-page .archive-highlight-card-6 { display: none; }',
)
text = text.replace(
    '.archive-page .archive-highlight-feature { right: 22px; bottom: 15px; max-width: 240px; padding: 10px 12px; border-radius: 12px; }',
    '.archive-page .archive-highlight-feature { display: none; }',
)
text = text.replace(
    '  .archive-page .archive-masthead h2::before { max-width: 330px; font-size: clamp(36px, 11vw, 48px); }',
    '  .archive-page .archive-masthead h2::before { max-width: 330px; font-size: clamp(32px, 9vw, 42px); }',
)
banner.write_text(text)

studio = Path("src/shareStudio.tsx")
text = studio.read_text()
pattern = re.compile(r'function buildJustifiedSlots\(records: EventRecord\[], area: Rect, spec: CanvasSpec\): PosterSlot\[] \{.*?\n\}\n\nfunction layoutJustifiedRows\(.*?\n\}\n\n(?=function buildMagazineSlots)', re.S)
replacement = '''function buildJustifiedSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
  if (!records.length) return [];
  const gap = spec.width >= 1500 ? 14 : 12;
  const ratios = records.map(recordPosterRatio);
  const totalRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const maxRows = Math.min(records.length, spec.format === "long" ? 12 : 8);
  let bestScore = Number.NEGATIVE_INFINITY;
  let best: PosterSlot[] = [];

  for (let rowCount = 1; rowCount <= maxRows; rowCount += 1) {
    const groups = partitionBalanced(records.length, rowCount);
    const availableHeight = (area.height - gap * Math.max(0, rowCount - 1)) / rowCount;
    let height = availableHeight;
    groups.forEach(([start, end]) => {
      const ratioSum = ratios.slice(start, end).reduce((sum, ratio) => sum + ratio, 0);
      const widthHeight = (area.width - gap * Math.max(0, end - start - 1)) / Math.max(0.01, ratioSum);
      height = Math.min(height, widthHeight);
    });
    if (!Number.isFinite(height) || height < 46) continue;

    const totalHeight = height * rowCount + gap * Math.max(0, rowCount - 1);
    let y = area.y + Math.max(0, (area.height - totalHeight) / 2);
    const candidate: PosterSlot[] = [];
    groups.forEach(([start, end]) => {
      const rowRatios = ratios.slice(start, end);
      const rowWidth = rowRatios.reduce((sum, ratio) => sum + ratio * height, 0) + gap * Math.max(0, rowRatios.length - 1);
      let x = area.x + Math.max(0, (area.width - rowWidth) / 2);
      for (let index = start; index < end; index += 1) {
        const width = ratios[index] * height;
        candidate.push({ record: records[index], rect: { x, y, width, height } });
        x += width + gap;
      }
      y += height + gap;
    });

    const occupiedArea = totalRatio * height * height;
    const fill = occupiedArea / Math.max(1, area.width * area.height);
    const readability = Math.min(1, height / (spec.format === "long" ? 190 : 150));
    const score = fill * 0.88 + readability * 0.12;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function partitionBalanced(itemCount: number, rowCount: number): Array<[number, number]> {
  const base = Math.floor(itemCount / rowCount);
  const remainder = itemCount % rowCount;
  const groups: Array<[number, number]> = [];
  let start = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const count = base + (row < remainder ? 1 : 0);
    groups.push([start, start + count]);
    start += count;
  }
  return groups;
}

'''
text, count = pattern.subn(replacement, text)
if count != 1:
    raise SystemExit(f"Expected one justified layout block, replaced {count}")
text = text.replace(
    '  let columns = records.length <= 8 ? 4 : records.length <= 16 ? 5 : records.length <= 24 ? 6 : 7;\n  if (spec.width >= 1500) columns += 1;',
    '  let columns = records.length <= 8 ? 3 : records.length <= 24 ? 4 : 5;\n  if (spec.width >= 1500) columns += 1;',
)
studio.write_text(text)
