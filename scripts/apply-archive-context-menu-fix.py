from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


# archive.tsx
path = "src/archive.tsx"
text = read(path)
text = replace_once(text, "  CalendarDays,\n  ChevronDown,", "  CalendarDays,\n  ChevronDown,\n  Copy,", "copy icon")
text = replace_once(text, "  Ticket,\n  X,", "  Ticket,\n  Trash2,\n  X,", "trash icon")
text = replace_once(text, 'import { useCachedMediaSrc } from "./mediaCache";\n', 'import { useCachedMediaSrc } from "./mediaCache";\nimport "./archiveContextMenu.css";\n', "context menu css import")
text = replace_once(text, "  onEdit: (record: EventRecord) => void;\n  onZoom: (media: MediaAsset) => void;", "  onEdit: (record: EventRecord) => void;\n  onDuplicate: (record: EventRecord) => void;\n  onDelete: (record: EventRecord) => void;\n  onZoom: (media: MediaAsset) => void;", "archive page action props")
text = replace_once(text, "  onOpen,\n  onEdit,\n  onZoom,", "  onOpen,\n  onEdit,\n  onDuplicate,\n  onDelete,\n  onZoom,", "archive page action destructure")
text = replace_once(text, '  const [expanded, setExpanded] = useState(false);\n', '  const [expanded, setExpanded] = useState(false);\n  const [contextMenu, setContextMenu] = useState<{ record: EventRecord; x: number; y: number } | null>(null);\n', "context menu state")

anchor = '  const activeFilterCount = filters.categories.length + filters.statuses.length + filters.years.length + filters.cities.length + filters.artists.length + filters.tags.length;\n\n'
addition = '''  const activeFilterCount = filters.categories.length + filters.statuses.length + filters.years.length + filters.cities.length + filters.artists.length + filters.tags.length;\n\n  useEffect(() => {\n    if (!contextMenu) return;\n    const closeFromPointer = (event: PointerEvent) => {\n      const target = event.target instanceof Element ? event.target : null;\n      if (target?.closest(".archive-context-menu")) return;\n      setContextMenu(null);\n    };\n    const close = () => setContextMenu(null);\n    const closeFromKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };\n    window.addEventListener("pointerdown", closeFromPointer);\n    window.addEventListener("resize", close);\n    window.addEventListener("scroll", close, true);\n    window.addEventListener("keydown", closeFromKey);\n    return () => {\n      window.removeEventListener("pointerdown", closeFromPointer);\n      window.removeEventListener("resize", close);\n      window.removeEventListener("scroll", close, true);\n      window.removeEventListener("keydown", closeFromKey);\n    };\n  }, [contextMenu]);\n\n  function handleArchiveContextMenu(event: MouseEvent<HTMLElement>) {\n    const target = event.target instanceof Element ? event.target : null;\n    const host = target?.closest<HTMLElement>("[data-archive-record-id]");\n    const record = host ? records.find((item) => item.id === host.dataset.archiveRecordId) : undefined;\n    if (!record) return;\n    event.preventDefault();\n    event.stopPropagation();\n    const width = 220;\n    const height = 222;\n    setContextMenu({\n      record,\n      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),\n      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),\n    });\n  }\n\n'''
text = replace_once(text, anchor, addition, "context menu behavior")
text = replace_once(text, '<section className="archive-page">', '<section className="archive-page" onContextMenu={handleArchiveContextMenu}>', "archive page context event")

# Record-bearing surfaces. Event delegation keeps one menu implementation for every view.
replacements = [
    ('<button className={`archive-highlight-card archive-highlight-card-${index + 1}`} key={record.id} type="button" onClick={() => onOpen(record)}>', '<button className={`archive-highlight-card archive-highlight-card-${index + 1}`} data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>'),
    ('<button className="archive-highlight-feature" type="button" onClick={() => onOpen(featured)}>', '<button className="archive-highlight-feature" data-archive-record-id={featured.id} type="button" onClick={() => onOpen(featured)}>'),
    ('<article className="archive-poster-card" onClick={() => onOpen(record)}>', '<article className="archive-poster-card" data-archive-record-id={record.id} onClick={() => onOpen(record)}>'),
    ('<article className={`showcase-card showcase-card-${index % 7}`} key={record.id} onClick={() => onOpen(record)}>', '<article className={`showcase-card showcase-card-${index % 7}`} data-archive-record-id={record.id} key={record.id} onClick={() => onOpen(record)}>'),
    ('<article className="archive-wallet-card" key={record.id} style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties}>', '<article className="archive-wallet-card" data-archive-record-id={record.id} key={record.id} style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties}>'),
    ('<button className="archive-ticket" key={record.id} type="button" onClick={() => onOpen(record)}>', '<button className="archive-ticket" data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>'),
    ('<button key={record.id} type="button" onClick={() => onOpen(record)}><time>', '<button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}><time>'),
    ('<button key={record.id} type="button" onClick={() => onOpen(record)}><strong>{record.date.slice(8)}</strong>', '<button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}><strong>{record.date.slice(8)}</strong>'),
    ('<button key={record.id} type="button" onClick={() => onOpen(record)}><span>{String(index + 1).padStart(2, "0")}</span>', '<button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}><span>{String(index + 1).padStart(2, "0")}</span>'),
    ('<button key={record.id} type="button" onClick={() => onOpen(record)}><span>{record.date}</span><strong>{record.title}</strong>', '<button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}><span>{record.date}</span><strong>{record.title}</strong>'),
]
for index, (old, new) in enumerate(replacements, start=1):
    text = replace_once(text, old, new, f"record context target {index}")

menu_anchor = '''      <ArchiveRenderer\n        records={visibleRecords}\n        layout={layout}\n        density={density}\n        onOpen={onOpen}\n        onEdit={onEdit}\n        onZoom={onZoom}\n      />\n    </section>'''
menu_replacement = '''      <ArchiveRenderer\n        records={visibleRecords}\n        layout={layout}\n        density={density}\n        onOpen={onOpen}\n        onEdit={onEdit}\n        onZoom={onZoom}\n      />\n      {contextMenu && (\n        <div\n          className="archive-context-menu"\n          role="menu"\n          aria-label={`${contextMenu.record.title} 快捷操作`}\n          style={{ left: contextMenu.x, top: contextMenu.y }}\n          onContextMenu={(event) => event.preventDefault()}\n        >\n          <header><strong>{contextMenu.record.title}</strong><span>{contextMenu.record.date} · {contextMenu.record.city || contextMenu.record.venue || "演出记录"}</span></header>\n          <button role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onOpen(record); }}><Eye />打开</button>\n          <button role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onEdit(record); }}><Pencil />编辑</button>\n          <button role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onDuplicate(record); }}><Copy />复制为新场次</button>\n          <button className="is-danger" role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onDelete(record); }}><Trash2 />删除</button>\n        </div>\n      )}\n    </section>'''
text = replace_once(text, menu_anchor, menu_replacement, "context menu render")
write(path, text)

# AppRoot.tsx
path = "src/AppRoot.tsx"
text = read(path)
text = replace_once(text, 'import { blankRecord } from "./seeds";\n', 'import { blankRecord } from "./seeds";\nimport { duplicateRecordForNextShow } from "./recordActions";\n', "duplicate helper import")
text = replace_once(
    text,
    '          onOpen={setSelected}\n          onEdit={setEditing}\n          onZoom={setZoomMedia}',
    '''          onOpen={setSelected}\n          onEdit={setEditing}\n          onDuplicate={(record) => {\n            setSelected(null);\n            setEditing(duplicateRecordForNextShow(record));\n            flash("已复制为下一场：日期顺延 1 天，座位与单场图片已清空");\n          }}\n          onDelete={(record) => setConfirmAction({\n            title: "移到回收站？",\n            message: `“${record.title}”会保留在回收站，可随时恢复。`,\n            confirmLabel: "移到回收站",\n            danger: true,\n            onConfirm: () => moveToTrash(record),\n          })}\n          onZoom={setZoomMedia}''',
    "archive context actions",
)
write(path, text)

# visual-audit.mjs: verify real browser right-click behavior on a poster card.
path = "scripts/visual-audit.mjs"
text = read(path)
anchor = '''  const firstRowCount = posterTops.filter((top) => Math.abs(top - posterTops[0]) <= 3).length;\n  if (firstRowCount < 5) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);\n\n  await archiveView("票夹", ".archive-wallet-card");'''
replacement = '''  const firstRowCount = posterTops.filter((top) => Math.abs(top - posterTops[0]) <= 3).length;\n  if (firstRowCount < 5) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);\n\n  await page.locator(".archive-poster-card").first().click({ button: "right" });\n  await page.locator(".archive-context-menu").waitFor({ state: "visible" });\n  const contextLabels = await page.locator(".archive-context-menu [role=menuitem]").allTextContents();\n  for (const label of ["打开", "编辑", "复制为新场次", "删除"]) {\n    if (!contextLabels.some((value) => value.includes(label))) throw new Error(`Archive context menu is missing ${label}`);\n  }\n  await page.keyboard.press("Escape");\n  await page.locator(".archive-context-menu").waitFor({ state: "detached" });\n\n  await archiveView("票夹", ".archive-wallet-card");'''
text = replace_once(text, anchor, replacement, "visual context menu audit")
write(path, text)

print("Applied archive card context menu and quick duplication feature")
