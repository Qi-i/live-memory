from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label):
    next_text, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"regex replacement failed ({count}): {label}")
    return next_text

# domain.ts: derive watched state from local event time without mutating stored data.
path = "src/domain.ts"
text = read(path)
marker = '''export function normalizeStatus(value: unknown, date?: string): EventStatus {\n  if (value === "watched" || value === "planned" || value === "wish") return value;\n  return date && date < todayIso() ? "watched" : "planned";\n}\n'''
addition = marker + '''\nexport function effectiveStatus(record: Pick<EventRecord, "status" | "date" | "time">, now = new Date()): EventStatus {\n  if (record.status !== "planned" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(record.date || "")) return record.status;\n  const time = /^\\d{1,2}:\\d{2}/.exec(record.time || "")?.[0] || "23:59";\n  const [hour, minute] = time.split(":").map(Number);\n  const eventAt = new Date(`${record.date}T00:00:00`);\n  if (Number.isNaN(eventAt.getTime())) return record.status;\n  eventAt.setHours(hour, minute, 0, 0);\n  return now.getTime() > eventAt.getTime() ? "watched" : record.status;\n}\n'''
text = replace_once(text, marker, addition, "effective status")
write(path, text)

# archive.tsx: use effective status everywhere, remove redundant strip, and de-duplicate hero artists.
path = "src/archive.tsx"
text = read(path)
text = replace_once(text, '  daysFromToday,\n  formatDateCn,', '  daysFromToday,\n  effectiveStatus,\n  formatDateCn,', "archive effective status import")
text = replace_once(text, '            <strong>{records.filter((record) => record.status === "watched").length}<span>已经看过</span></strong>', '            <strong>{records.filter((record) => effectiveStatus(record) === "watched").length}<span>已经看过</span></strong>', "masthead watched count")
text = sub_once(text, r'\n      <div className="archive-result-strip">.*?</div>\n\n      <ArchiveRenderer', '\n\n      <ArchiveRenderer', "remove result strip")
text = text.replace('statusLabels[record.status]', 'statusLabels[effectiveStatus(record)]')
text = replace_once(text, '    if (filters.statuses.length && !filters.statuses.includes(record.status)) return false;', '    if (filters.statuses.length && !filters.statuses.includes(effectiveStatus(record))) return false;', "status filter")
text = replace_once(text, '    statuses: unique(records.map((record) => record.status)) as EventStatus[],', '    statuses: unique(records.map((record) => effectiveStatus(record))) as EventStatus[],', "status facets")
text = sub_once(
    text,
    r'function ArchiveHighlights\(\{ records, onOpen \}: \{ records: EventRecord\[]; onOpen: \(record: EventRecord\) => void \}\) \{\n  const highlights = records\.filter\(\(record\) => primaryMedia\(record\)\)\.slice\(0, 6\);',
    '''function pickArchiveHighlights(records: EventRecord[], limit = 5) {\n  const candidates = [...records]\n    .filter((record) => primaryMedia(record))\n    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));\n  const selected: EventRecord[] = [];\n  const usedArtists = new Set<string>();\n  const selectedIds = new Set<string>();\n  for (const record of candidates) {\n    const artists = record.artists.map((artist) => artist.trim().toLowerCase()).filter(Boolean);\n    if (artists.length && artists.some((artist) => usedArtists.has(artist))) continue;\n    selected.push(record);\n    selectedIds.add(record.id);\n    artists.forEach((artist) => usedArtists.add(artist));\n    if (selected.length >= limit) return selected;\n  }\n  for (const record of candidates) {\n    if (selectedIds.has(record.id)) continue;\n    selected.push(record);\n    if (selected.length >= limit) break;\n  }\n  return selected;\n}\n\nfunction ArchiveHighlights({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {\n  const highlights = pickArchiveHighlights(records, 5);''',
    "highlight selection",
)
write(path, text)

# AppRoot top metrics.
path = "src/AppRoot.tsx"
text = read(path)
text = replace_once(text, 'import type { AppSettings } from "./domain";', 'import type { AppSettings } from "./domain";\nimport { effectiveStatus } from "./domain";', "AppRoot effective import")
text = replace_once(text, '  const watchedCount = activeRecords.filter((record) => record.status === "watched").length;', '  const watchedCount = activeRecords.filter((record) => effectiveStatus(record) === "watched").length;', "AppRoot watched count")
write(path, text)

# Stats page.
path = "src/statsPage.tsx"
text = read(path)
text = replace_once(text, 'import { categoryLabels } from "./domain";', 'import { categoryLabels, effectiveStatus } from "./domain";', "stats effective import")
text = replace_once(text, '  const watched = records.filter((record) => record.status === "watched");\n  const planned = records.filter((record) => record.status !== "watched");', '  const watched = records.filter((record) => effectiveStatus(record) === "watched");\n  const planned = records.filter((record) => effectiveStatus(record) !== "watched");', "stats watched split")
write(path, text)

# Share studio metrics.
path = "src/shareStudio.tsx"
text = read(path)
text = replace_once(text, 'import { categoryLabels, primaryMedia } from "./domain";', 'import { categoryLabels, effectiveStatus, primaryMedia } from "./domain";', "share effective import")
text = replace_once(text, '  const watched = selectedRecords.filter((record) => record.status === "watched").length;', '  const watched = selectedRecords.filter((record) => effectiveStatus(record) === "watched").length;', "share watched count")
write(path, text)

# Detail/editor status should match archive presentation.
path = "src/overlays.tsx"
text = read(path)
text = replace_once(text, '  createId,\n  formatDateCn,', '  createId,\n  effectiveStatus,\n  formatDateCn,', "overlay effective import")
text = replace_once(text, '            <span>{categoryLabels[record.category]} · {statusLabels[record.status]}</span>', '            <span>{categoryLabels[record.category]} · {statusLabels[effectiveStatus(record)]}</span>', "detail effective status")
text = replace_once(text, '  const [draft, setDraft] = useState(record);', '  const [draft, setDraft] = useState(() => ({ ...record, status: effectiveStatus(record) }));', "editor effective initial state")
text = replace_once(text, '    setDraft(record);', '    setDraft({ ...record, status: effectiveStatus(record) });', "editor effective reset")
write(path, text)

# archiveBanner.css: compact premium masthead, five-poster fan, proper ticket crop/alignment.
path = "src/archiveBanner.css"
text = read(path)
text += '''\n\n/* 2026-09 archive hero + ticket refinement */\n@media (min-width: 1121px) {\n  .archive-page .archive-masthead {\n    grid-template-columns: minmax(390px, .78fr) minmax(650px, 1.22fr);\n    min-height: 348px;\n  }\n  .archive-page .archive-masthead-copy {\n    min-height: 348px;\n    padding: 25px clamp(32px, 3.3vw, 48px) 23px;\n  }\n  .archive-page .archive-masthead-copy::before { inset: 16px 10px 16px 18px; }\n  .archive-page .archive-masthead-copy::after { top: 42px; right: 30px; width: 104px; height: 104px; }\n  .archive-page .archive-masthead h2 { margin-top: 13px; }\n  .archive-page .archive-masthead h2::before { font-size: clamp(35px, 3.05vw, 48px); }\n  .archive-page .archive-masthead p { max-width: 445px; font-size: 12px; line-height: 1.55; }\n  .archive-page .archive-masthead-actions { margin-top: 14px; }\n  .archive-page .archive-masthead-stats { margin-top: 14px; }\n  .archive-page .archive-highlights { min-height: 348px; }\n  .archive-page .archive-highlight-stack { inset: 9px 8px 12px 0; }\n  .archive-page .archive-highlight-card { display: block; border-width: 4px; border-radius: 14px; }\n  .archive-page .archive-highlight-card-1 { top: 5%; left: 39%; width: 23%; height: 88%; z-index: 7; transform: rotate(-1deg) translateZ(78px); }\n  .archive-page .archive-highlight-card-2 { top: 14%; left: 20%; width: 22%; height: 75%; z-index: 5; transform: rotate(-6deg) translateZ(32px); }\n  .archive-page .archive-highlight-card-3 { top: 14%; left: 59%; right: auto; width: 22%; height: 76%; z-index: 5; transform: rotate(6deg) translateZ(34px); }\n  .archive-page .archive-highlight-card-4 { top: 22%; left: 4%; width: 20%; height: 65%; z-index: 3; transform: rotate(-9deg) translateZ(8px); }\n  .archive-page .archive-highlight-card-5 { top: 21%; left: 77%; width: 20%; height: 66%; z-index: 3; transform: rotate(9deg) translateZ(10px); }\n  .archive-page .archive-highlight-card-6 { display: none; }\n  .archive-page .archive-highlight-card img { object-fit: cover; object-position: center 18%; transform: scale(1.025); }\n  .archive-page .archive-highlight-card > span:last-child { right: 6px; bottom: 6px; left: 6px; padding: 5px 7px; }\n}\n\n.archive-page .archive-ticket-grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; align-items: stretch; }\n.archive-page .archive-ticket { grid-template-columns: 128px minmax(0, 1fr); min-height: 170px; height: 100%; align-items: stretch; border-radius: 15px; }\n.archive-page .archive-ticket > div { min-height: 170px; overflow: hidden; background: #101418; }\n.archive-page .archive-ticket > div img,\n.archive-page .archive-ticket > div > .record-media-fallback {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  object-position: center 18%;\n}\n.archive-page .archive-ticket > section { display: flex; min-width: 0; flex-direction: column; justify-content: flex-start; padding: 15px 15px 13px 21px; }\n.archive-page .archive-ticket h3 { min-height: 2.35em; margin: 5px 0 3px; font-size: 17px; line-height: 1.18; }\n.archive-page .archive-ticket p { margin: 0 0 8px; font-size: 10px; }\n.archive-page .archive-ticket dl { margin-top: auto; grid-template-columns: 38px minmax(0,1fr); gap: 3px 6px; font-size: 9.5px; }\n\n@media (max-width: 1120px) {\n  .archive-page .archive-masthead-copy { min-height: 330px; }\n  .archive-page .archive-highlights { min-height: 300px; }\n  .archive-page .archive-highlight-card-4,\n  .archive-page .archive-highlight-card-5 { display: block; }\n  .archive-page .archive-highlight-card-1 { left: 39%; width: 23%; }\n  .archive-page .archive-highlight-card-2 { left: 19%; width: 22%; }\n  .archive-page .archive-highlight-card-3 { right: auto; left: 59%; width: 22%; }\n  .archive-page .archive-highlight-card-4 { top: 25%; left: 3%; width: 19%; height: 58%; }\n  .archive-page .archive-highlight-card-5 { top: 25%; left: 78%; width: 19%; height: 58%; transform: rotate(9deg); }\n}\n\n@media (max-width: 720px) {\n  .archive-page .archive-masthead-copy { min-height: 286px; }\n  .archive-page .archive-highlights { min-height: 218px; }\n  .archive-page .archive-highlight-card-4,\n  .archive-page .archive-highlight-card-5 { display: block; }\n  .archive-page .archive-highlight-card-1 { top: 4%; left: 39%; width: 23%; height: 88%; }\n  .archive-page .archive-highlight-card-2 { top: 17%; left: 19%; width: 22%; height: 70%; }\n  .archive-page .archive-highlight-card-3 { top: 17%; right: auto; left: 59%; width: 22%; height: 70%; }\n  .archive-page .archive-highlight-card-4 { top: 27%; left: 3%; width: 18%; height: 56%; }\n  .archive-page .archive-highlight-card-5 { top: 27%; left: 79%; width: 18%; height: 56%; transform: rotate(9deg); }\n  .archive-page .archive-highlight-card > span:last-child { display: none; }\n  .archive-page .archive-ticket-grid { grid-template-columns: 1fr; }\n  .archive-page .archive-ticket { grid-template-columns: 104px minmax(0, 1fr); min-height: 146px; }\n  .archive-page .archive-ticket > div { min-height: 146px; }\n  .archive-page .archive-ticket > section { padding: 12px 12px 10px 18px; }\n  .archive-page .archive-ticket h3 { font-size: 14px; }\n}\n'''
write(path, text)

# Strengthen visual audit for the exact screenshot regressions.
path = "scripts/visual-audit.mjs"
text = read(path)
text = replace_once(text, '  if (!masthead || bannerCards.length < 3 || bannerCards.length > 4) {\n    throw new Error(`Banner should show 3–4 representative posters, got ${bannerCards.length}`);\n  }', '  if (!masthead || bannerCards.length < 4 || bannerCards.length > 5) {\n    throw new Error(`Banner should show 4–5 representative posters, got ${bannerCards.length}`);\n  }\n  if (masthead.height > 390) throw new Error(`Banner is still too tall: ${masthead.height}`);\n  if (await page.locator(".archive-result-strip").count()) throw new Error("Redundant archive result strip is still rendered");', "banner visual expectations")
text = replace_once(text, '  await archiveView("票根", ".archive-ticket");\n  await page.screenshot({ path: `${outputDir}/04-ticket-desktop.png`, fullPage: true });', '''  await archiveView("票根", ".archive-ticket");\n  const ticketGeometry = await page.locator(".archive-ticket").first().evaluate((card) => {\n    const cover = card.querySelector(":scope > div");\n    const image = cover?.querySelector("img");\n    const cardRect = card.getBoundingClientRect();\n    const coverRect = cover?.getBoundingClientRect();\n    const sectionRect = card.querySelector(":scope > section")?.getBoundingClientRect();\n    return {\n      objectFit: image ? getComputedStyle(image).objectFit : "fallback",\n      card: { top: cardRect.top, bottom: cardRect.bottom, left: cardRect.left },\n      cover: coverRect ? { top: coverRect.top, bottom: coverRect.bottom, left: coverRect.left, right: coverRect.right } : null,\n      section: sectionRect ? { top: sectionRect.top, bottom: sectionRect.bottom, left: sectionRect.left } : null,\n    };\n  });\n  if (!ticketGeometry.cover || !ticketGeometry.section\n    || ticketGeometry.objectFit !== "cover"\n    || Math.abs(ticketGeometry.cover.top - ticketGeometry.card.top) > 2\n    || Math.abs(ticketGeometry.cover.bottom - ticketGeometry.card.bottom) > 2\n    || ticketGeometry.section.left < ticketGeometry.cover.right - 1) {\n    throw new Error(`Ticket cover crop/alignment is invalid: ${JSON.stringify(ticketGeometry)}`);\n  }\n  await page.screenshot({ path: `${outputDir}/04-ticket-desktop.png`, fullPage: true });''', "ticket visual audit")
write(path, text)

print("Applied archive hero, ticket layout, and automatic watched-status refinements")
