from pathlib import Path

root = Path(__file__).resolve().parents[1]

def rw(path):
    p = root / path
    return p, p.read_text(encoding="utf-8")

# Balance archive picture-book cards into real columns instead of CSS multicol balancing.
p, s = rw("src/archive.tsx")
start = s.index('function ShowcaseView(')
end = s.index('\nfunction WalletView(', start)
new_showcase = '''function ShowcaseView({ records, density, onOpen, onZoom }: { records: EventRecord[]; density: number; onOpen: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  const columnCount = Math.min(Math.max(2, density), Math.max(1, records.length));
  const columns = Array.from({ length: columnCount }, () => [] as EventRecord[]);
  const heights = Array.from({ length: columnCount }, () => 0);
  records.forEach((record) => {
    const poster = primaryMedia(record);
    const ratio = poster?.width && poster.height ? Math.max(0.58, Math.min(1.28, poster.width / poster.height)) : 0.8;
    const target = heights.indexOf(Math.min(...heights));
    columns[target].push(record);
    heights[target] += 1 / ratio + 0.04;
  });
  return (
    <section className="archive-showcase" style={{ "--showcase-columns": columnCount } as CSSProperties}>
      {columns.map((items, columnIndex) => (
        <div className="showcase-column" key={`column-${columnIndex}`}>
          {items.map((record) => {
            const poster = primaryMedia(record);
            const ratio = poster?.width && poster.height ? Math.max(0.58, Math.min(1.28, poster.width / poster.height)) : 0.8;
            return (
              <article className="showcase-card" style={{ aspectRatio: String(ratio) }} data-archive-record-id={record.id} key={record.id} onClick={() => onOpen(record)}>
                <button type="button" onClick={(event) => { event.stopPropagation(); if (poster) onZoom(poster); }}>
                  <RecordMedia media={poster} alt={record.title} fallback={record.title.slice(0, 3)} />
                </button>
                <div>
                  <span>{record.date.slice(0, 4)} · {record.city || categoryLabels[record.category]}</span>
                  <h3>{record.title}</h3>
                  <p>{record.artists.join(" / ") || record.venue || "演出记录"}</p>
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
'''
s = s[:start] + new_showcase + s[end:]
p.write_text(s, encoding="utf-8")

# Center incomplete final ticket rows.
p, s = rw("src/shareStudio.tsx")
old = '''  return records.map((record, index) => ({
    record,
    rect: {
      x: area.x + (index % columns) * (width + gap),
      y: area.y + Math.floor(index / columns) * (height + gap),
      width,
      height,
    },
  }));'''
new = '''  return records.map((record, index) => {
    const row = Math.floor(index / columns);
    const rowStart = row * columns;
    const rowItemCount = Math.min(columns, records.length - rowStart);
    const rowWidth = rowItemCount * width + gap * Math.max(0, rowItemCount - 1);
    const rowOffset = Math.max(0, (area.width - rowWidth) / 2);
    return {
      record,
      rect: {
        x: area.x + rowOffset + (index - rowStart) * (width + gap),
        y: area.y + row * (height + gap),
        width,
        height,
      },
    };
  });'''
if old not in s: raise SystemExit('ticket slot target missing')
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")

# Final cascade overrides the old experimental multi-column rules.
p, s = rw("src/archive.css")
s += '''\n\n/* Balanced picture-book columns: every configured column participates. */\n.archive-showcase {\n  display: grid;\n  grid-template-columns: repeat(var(--showcase-columns), minmax(0, 1fr));\n  gap: 8px;\n  column-count: initial;\n  column-width: auto;\n}\n.showcase-column { display: flex; min-width: 0; flex-direction: column; gap: 8px; }\n.archive-showcase .showcase-card { display: block; width: 100%; margin: 0; flex: 0 0 auto; }\n@media (max-width: 760px) {\n  .archive-showcase { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }\n  .showcase-column { gap: 6px; }\n  .showcase-column:nth-child(n+3) { display: contents; }\n}\n'''
p.write_text(s, encoding="utf-8")

# Strengthen source contract.
p, s = rw("scripts/archive-experience-redesign-tests.mjs")
s = s.replace('assert.match(archiveCss, /column-width|columns:/);', 'assert.match(archive, /showcase-column/);\nassert.match(archive, /heights\.indexOf\(Math\.min\(\.\.\.heights\)\)/);\nassert.match(archiveCss, /--showcase-columns/);')
p.write_text(s, encoding="utf-8")

# Visual audit: require grid to occupy the available width.
p, s = rw("scripts/visual-audit.mjs")
old = '''  const showcase = await page.locator(".archive-showcase").evaluate((node) => ({ display: getComputedStyle(node).display, columnCount: getComputedStyle(node).columnCount, gap: getComputedStyle(node).columnGap }));
  if (showcase.display !== "block" || Number(showcase.columnCount) < 2 || parseFloat(showcase.gap) > 10) throw new Error(`Showcase is not using compact columns: ${JSON.stringify(showcase)}`);'''
new = '''  const showcase = await page.locator(".archive-showcase").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const columns = Array.from(node.querySelectorAll(":scope > .showcase-column")).filter((item) => getComputedStyle(item).display !== "none");
    const last = columns.at(-1)?.getBoundingClientRect();
    return { display: getComputedStyle(node).display, gridColumns: getComputedStyle(node).gridTemplateColumns, gap: getComputedStyle(node).gap, columnCount: columns.length, widthUse: last ? (last.right - rect.left) / rect.width : 0 };
  });
  if (showcase.display !== "grid" || showcase.columnCount < 2 || parseFloat(showcase.gap) > 10 || showcase.widthUse < 0.96) throw new Error(`Showcase is not using balanced full-width columns: ${JSON.stringify(showcase)}`);'''
if old not in s: raise SystemExit('visual showcase target missing')
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")

print('Refined showcase and ticket layout')
