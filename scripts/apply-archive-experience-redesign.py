from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    next_text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"regex replacement failed ({count}): {label}")
    return next_text


# ── shareStudio.tsx ─────────────────────────────────────────────
path = "src/shareStudio.tsx"
text = read(path)
text = replace_once(text, '  Search,\n  X,', '  Search,\n  Ticket,\n  X,', 'share icon import')
text = replace_once(text, 'type ShareLayout = "wall" | "timeline" | "magazine" | "cities";', 'type ShareLayout = "wall" | "tickets" | "timeline" | "magazine" | "cities";', 'share layout union')
text = replace_once(text,
    '  { value: "wall", label: "密集海报墙", description: "按原比例紧密拼接，适合一次分享很多现场", icon: <Grid3X3 /> },\n',
    '  { value: "wall", label: "密集海报墙", description: "按原比例紧密拼接，适合一次分享很多现场", icon: <Grid3X3 /> },\n  { value: "tickets", label: "票根聚合", description: "把海报色彩、日期、场馆与座位整理成磨砂票根", icon: <Ticket /> },\n',
    'ticket layout option')
text = replace_once(text, '    () => records\n      .filter((record) => primaryMedia(record))\n      .slice()', '    () => records\n      .slice()', 'share all records eligibility')
text = replace_once(text, 'const [itemLimit, setItemLimit] = useState<ItemLimit>(20);', 'const [itemLimit, setItemLimit] = useState<ItemLimit>("all");', 'default share limit')
text = text.replace('张海报进入成图', '项档案进入成图')
text = text.replace('分享布局 <small>四种布局会真实改变海报组织方式</small>', '分享布局 <small>五种布局会真实改变内容组织方式</small>')
text = text.replace('`保存 ${selectedRecords.length} 张海报的 PNG`', '`保存 ${selectedRecords.length} 项档案的 PNG`')

anchor = '  if (layout === "timeline") {\n'
ticket_preview = '''  if (layout === "tickets") {\n    const slots = buildTicketSlots(records, area, spec);\n    return (\n      <div className="share-layout-canvas share-layout-canvas-tickets share-ticket-grid" style={rectStyle(area)}>\n        {slots.map((slot) => <ShareTicketCard key={slot.record.id} slot={slot} origin={area} />)}\n      </div>\n    );\n  }\n\n'''
text = replace_once(text, anchor, ticket_preview + anchor, 'ticket preview branch')

poster_anchor = 'function PosterFigure({ slot, origin, showDetails }: { slot: PosterSlot; origin: Rect; showDetails: boolean }) {'
ticket_helpers = '''function buildTicketSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {\n  if (!records.length) return [];\n  const gap = spec.width >= 1500 ? 16 : 12;\n  const landscape = isLandscapeFormat(spec.format);\n  const idealWidth = landscape ? 420 : 350;\n  const maxColumns = landscape ? 4 : 3;\n  const columns = Math.max(1, Math.min(maxColumns, records.length, Math.round((area.width + gap) / (idealWidth + gap))));\n  const rows = Math.ceil(records.length / columns);\n  const width = (area.width - gap * Math.max(0, columns - 1)) / columns;\n  const height = (area.height - gap * Math.max(0, rows - 1)) / Math.max(1, rows);\n  return records.map((record, index) => ({\n    record,\n    rect: {\n      x: area.x + (index % columns) * (width + gap),\n      y: area.y + Math.floor(index / columns) * (height + gap),\n      width,\n      height,\n    },\n  }));\n}\n\nfunction ShareTicketCard({ slot, origin }: { slot: PosterSlot; origin: Rect }) {\n  const media = primaryMedia(slot.record);\n  const src = useCachedMediaSrc(media);\n  const style = {\n    ...localRectStyle(slot.rect, origin),\n    "--ticket-a": slot.record.colors[0] || "#172229",\n    "--ticket-b": slot.record.colors[1] || "#47645d",\n  } as CSSProperties;\n  return (\n    <article className="share-ticket-card" style={style}>\n      <span className="share-ticket-backdrop" aria-hidden="true">{src ? <img src={src} alt="" decoding="async" /> : null}</span>\n      <span className="share-ticket-tint" aria-hidden="true" />\n      <div className="share-ticket-poster"><SharePoster record={slot.record} /></div>\n      <section>\n        <span>{slot.record.date} · {slot.record.city || categoryLabels[slot.record.category]}</span>\n        <h3>{slot.record.title}</h3>\n        <p>{slot.record.artists.join(" / ") || "艺人待补"}</p>\n        <dl>\n          <dt>VENUE</dt><dd>{slot.record.venue || "场馆待补"}</dd>\n          <dt>SEAT</dt><dd>{slot.record.seat || "座位待补"}</dd>\n          <dt>PRICE</dt><dd>{slot.record.price ? `¥${slot.record.price}` : slot.record.publicPriceRange || "票价待补"}</dd>\n        </dl>\n      </section>\n    </article>\n  );\n}\n\n'''
text = replace_once(text, poster_anchor, ticket_helpers + poster_anchor, 'ticket preview helpers')

adaptive_anchor = '  if (layout === "wall") {\n'
adaptive_ticket = '''  if (layout === "tickets") {\n    const columns = landscape ? Math.min(4, Math.max(2, Math.ceil(Math.sqrt(records.length * 1.35)))) : Math.min(3, Math.max(1, Math.ceil(Math.sqrt(records.length * 0.72))));\n    const rows = Math.ceil(records.length / columns);\n    const ticketHeight = landscape ? 235 : 270;\n    const contentHeight = Math.max(landscape ? 560 : 940, rows * ticketHeight + Math.max(0, rows - 1) * 14);\n    return { width, height: chromeHeight + contentHeight, padding, headerHeight, footerHeight, format };\n  }\n\n'''
text = replace_once(text, adaptive_anchor, adaptive_ticket + adaptive_anchor, 'adaptive ticket canvas spec')

long_old = '''  const contentHeight = layout === "timeline"\n    ? Math.max(960, groupCount * 300)\n    : layout === "cities"\n      ? Math.max(980, groupCount * 250)\n      : layout === "magazine"\n        ? Math.max(980, Math.ceil(Math.max(1, count) / 4) * 290)\n        : Math.max(980, Math.ceil(Math.max(1, count) / 4) * 265);'''
long_new = '''  const contentHeight = layout === "timeline"\n    ? Math.max(960, groupCount * 300)\n    : layout === "cities"\n      ? Math.max(980, groupCount * 250)\n      : layout === "tickets"\n        ? Math.max(980, Math.ceil(Math.max(1, count) / 3) * 285)\n        : layout === "magazine"\n          ? Math.max(980, Math.ceil(Math.max(1, count) / 4) * 290)\n          : Math.max(980, Math.ceil(Math.max(1, count) / 4) * 265);'''
text = replace_once(text, long_old, long_new, 'long ticket canvas spec')

export_old = '''  if (options.layout === "timeline") await drawTimelineCanvas(context, buildTimelineBands(options.records, area, spec), options, palette);\n  else if (options.layout === "cities") await drawCitiesCanvas(context, buildCityModel(options.records, area, spec), options, palette);\n  else {'''
export_new = '''  if (options.layout === "timeline") await drawTimelineCanvas(context, buildTimelineBands(options.records, area, spec), options, palette);\n  else if (options.layout === "cities") await drawCitiesCanvas(context, buildCityModel(options.records, area, spec), options, palette);\n  else if (options.layout === "tickets") {\n    for (const slot of buildTicketSlots(options.records, area, spec)) await drawTicket(context, slot.record, slot.rect, palette);\n  } else {'''
text = replace_once(text, export_old, export_new, 'ticket canvas export branch')

draw_anchor = 'async function drawTimelineCanvas(context: CanvasRenderingContext2D, bands: TimelineBand[], options: ExportOptions, palette: PaletteDefinition) {'
draw_ticket = '''async function drawTicket(\n  context: CanvasRenderingContext2D,\n  record: EventRecord,\n  slot: Rect,\n  palette: PaletteDefinition,\n) {\n  context.save();\n  roundedPath(context, slot.x, slot.y, slot.width, slot.height, Math.max(12, slot.height * 0.06));\n  context.clip();\n  const image = await loadMediaImage(primaryMedia(record));\n  if (image) {\n    context.save();\n    context.filter = "blur(20px) saturate(1.15)";\n    drawCover(context, image, slot.x - 20, slot.y - 20, slot.width + 40, slot.height + 40, record.colors[0] || palette.surface);\n    context.restore();\n  } else {\n    drawFallback(context, record, slot.x, slot.y, slot.width, slot.height);\n  }\n  const tint = context.createLinearGradient(slot.x, slot.y, slot.x + slot.width, slot.y + slot.height);\n  tint.addColorStop(0, `${record.colors[0] || "#172229"}dc`);\n  tint.addColorStop(1, `${record.colors[1] || "#47645d"}b8`);\n  context.fillStyle = tint;\n  context.fillRect(slot.x, slot.y, slot.width, slot.height);\n\n  const posterWidth = Math.min(slot.width * 0.29, slot.height * 0.72);\n  const posterRect = { x: slot.x + 18, y: slot.y + 18, width: posterWidth, height: slot.height - 36 };\n  if (image) drawCover(context, image, posterRect.x, posterRect.y, posterRect.width, posterRect.height, palette.surface);\n  else drawFallback(context, record, posterRect.x, posterRect.y, posterRect.width, posterRect.height);\n  roundedPath(context, posterRect.x, posterRect.y, posterRect.width, posterRect.height, 10);\n  context.strokeStyle = "rgba(255,255,255,.42)";\n  context.lineWidth = 1.5;\n  context.stroke();\n\n  const copyX = posterRect.x + posterRect.width + 20;\n  const copyWidth = slot.x + slot.width - copyX - 18;\n  context.fillStyle = "rgba(255,255,255,.86)";\n  roundedPath(context, copyX - 10, slot.y + 18, copyWidth + 10, slot.height - 36, 12);\n  context.fill();\n  context.fillStyle = "#15201f";\n  context.font = `900 ${Math.max(16, slot.height * 0.105)}px system-ui, sans-serif`;\n  context.fillText(trimText(context, record.title, copyWidth - 8), copyX, slot.y + slot.height * 0.34);\n  context.fillStyle = "rgba(21,32,31,.66)";\n  context.font = `800 ${Math.max(10, slot.height * 0.055)}px system-ui, sans-serif`;\n  context.fillText(trimText(context, record.artists.join(" / ") || "艺人待补", copyWidth - 8), copyX, slot.y + slot.height * 0.48);\n  context.font = `750 ${Math.max(9, slot.height * 0.047)}px system-ui, sans-serif`;\n  context.fillText(trimText(context, `${record.date} · ${record.city || "城市待补"} · ${record.venue || "场馆待补"}`, copyWidth - 8), copyX, slot.y + slot.height * 0.64);\n  context.fillText(trimText(context, `${record.seat || "座位待补"} · ${record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"}`, copyWidth - 8), copyX, slot.y + slot.height * 0.78);\n  context.restore();\n\n  roundedPath(context, slot.x, slot.y, slot.width, slot.height, Math.max(12, slot.height * 0.06));\n  context.strokeStyle = palette.border;\n  context.lineWidth = 1.5;\n  context.stroke();\n}\n\n'''
text = replace_once(text, draw_anchor, draw_ticket + draw_anchor, 'ticket canvas draw function')
write(path, text)

# ── shareStudio.css ─────────────────────────────────────────────
path = "src/shareStudio.css"
text = read(path)
css = r'''

/* Ticket aggregation: poster-derived color, glass surface, same geometry in smart canvases. */
.share-layout-canvas-tickets { overflow: hidden; }
.share-ticket-card {
  position: absolute;
  display: grid;
  grid-template-columns: minmax(74px, 28%) minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, white 38%, transparent);
  border-radius: 18px;
  color: #12201d;
  background: linear-gradient(135deg, var(--ticket-a), var(--ticket-b));
  box-shadow: 0 16px 36px rgba(10, 20, 18, .18);
  isolation: isolate;
}
.share-ticket-backdrop {
  position: absolute;
  inset: -24px;
  z-index: -3;
  overflow: hidden;
  opacity: .58;
  filter: blur(22px) saturate(1.18);
  transform: scale(1.12);
}
.share-ticket-backdrop img { width: 100%; height: 100%; object-fit: cover; }
.share-ticket-tint {
  position: absolute;
  inset: 0;
  z-index: -2;
  background: linear-gradient(125deg, color-mix(in srgb, var(--ticket-a) 86%, transparent), color-mix(in srgb, var(--ticket-b) 74%, rgba(255,255,255,.28)));
}
.share-ticket-poster { min-width: 0; margin: 14px 0 14px 14px; overflow: hidden; border-radius: 11px; box-shadow: 0 10px 22px rgba(0,0,0,.2); }
.share-ticket-poster .share-poster-frame { width: 100%; height: 100%; aspect-ratio: auto !important; }
.share-ticket-card > section {
  min-width: 0;
  margin: 12px;
  padding: 13px 14px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.34);
  border-radius: 13px;
  background: rgba(255,255,255,.72);
  backdrop-filter: blur(18px) saturate(1.08);
}
.share-ticket-card section > span { color: rgba(18,32,29,.62); font-size: 11px; font-weight: 900; }
.share-ticket-card h3 { margin: 6px 0 4px; overflow: hidden; font-size: clamp(15px, 1.35vw, 23px); line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
.share-ticket-card p { margin: 0 0 10px; overflow: hidden; color: rgba(18,32,29,.68); font-size: 11px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.share-ticket-card dl { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 4px 8px; margin: 0; font-size: 10px; }
.share-ticket-card dt { color: rgba(18,32,29,.58); font-weight: 950; }
.share-ticket-card dd { min-width: 0; margin: 0; overflow: hidden; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
'''
if '/* Ticket aggregation:' not in text:
    text += css
write(path, text)

# ── archive.tsx ────────────────────────────────────────────────
path = "src/archive.tsx"
text = read(path)
text = replace_once(text, '  useMemo,\n  useState,', '  useMemo,\n  useRef,\n  useState,', 'archive useRef import')
text = replace_once(text, 'import { useCachedMediaSrc } from "./mediaCache";', 'import { useCachedMediaSrc } from "./mediaCache";\nimport { loadAmap } from "./amap";', 'amap import')
text = replace_once(text, '  onZoom: (media: MediaAsset) => void;\n}', '  onZoom: (media: MediaAsset) => void;\n  onOpenMapSettings: () => void;\n}', 'archive page prop')
text = replace_once(text, '  onDelete,\n  onZoom,\n}: ArchivePageProps)', '  onDelete,\n  onZoom,\n  onOpenMapSettings,\n}: ArchivePageProps)', 'archive page destructure')
text = replace_once(text,
'''      <ArchiveRenderer\n        records={visibleRecords}\n        layout={layout}\n        density={density}\n        onOpen={onOpen}\n        onEdit={onEdit}\n        onZoom={onZoom}\n      />''',
'''      <ArchiveRenderer\n        records={visibleRecords}\n        layout={layout}\n        density={density}\n        mapSettings={settings.map}\n        onOpenMapSettings={onOpenMapSettings}\n        onOpen={onOpen}\n        onEdit={onEdit}\n        onZoom={onZoom}\n      />''',
'archive renderer call')

text = replace_once(text,
'''  density,\n  onOpen,\n  onEdit,\n  onZoom,\n}: {\n  records: EventRecord[];\n  layout: ArchiveLayout;\n  density: number;\n  onOpen: (record: EventRecord) => void;\n  onEdit: (record: EventRecord) => void;\n  onZoom: (media: MediaAsset) => void;\n}) {''',
'''  density,\n  mapSettings,\n  onOpenMapSettings,\n  onOpen,\n  onEdit,\n  onZoom,\n}: {\n  records: EventRecord[];\n  layout: ArchiveLayout;\n  density: number;\n  mapSettings: AppSettings["map"];\n  onOpenMapSettings: () => void;\n  onOpen: (record: EventRecord) => void;\n  onEdit: (record: EventRecord) => void;\n  onZoom: (media: MediaAsset) => void;\n}) {''',
'archive renderer props')
text = replace_once(text, '  if (layout === "venue") return <VenueView records={records} onOpen={onOpen} />;', '  if (layout === "venue") return <VenueView records={records} mapSettings={mapSettings} onOpenMapSettings={onOpenMapSettings} onOpen={onOpen} />;', 'venue renderer wiring')

show_old = '''      {records.map((record, index) => {\n        const poster = primaryMedia(record);\n        return (\n          <article className={`showcase-card showcase-card-${index % 7}`} data-archive-record-id={record.id} key={record.id} onClick={() => onOpen(record)}>'''
show_new = '''      {records.map((record) => {\n        const poster = primaryMedia(record);\n        const ratio = poster?.width && poster.height ? Math.max(0.58, Math.min(1.28, poster.width / poster.height)) : 0.8;\n        return (\n          <article className="showcase-card" style={{ aspectRatio: String(ratio) }} data-archive-record-id={record.id} key={record.id} onClick={() => onOpen(record)}>'''
text = replace_once(text, show_old, show_new, 'showcase masonry markup')

ticket_old = '''        <button className="archive-ticket" data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>\n          <div><RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 2)} /></div>\n          <section><span>{categoryLabels[record.category]}</span><h3>{record.title}</h3><p>{record.artists.join(" / ") || "艺人待补"}</p><dl><dt>DATE</dt><dd>{record.date}</dd><dt>VENUE</dt><dd>{record.city} · {record.venue}</dd><dt>SEAT</dt><dd>{record.seat || "座位待补"}</dd></dl></section>\n        </button>'''
ticket_new = '''        <button className="archive-ticket" data-archive-record-id={record.id} key={record.id} type="button" style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties} onClick={() => onOpen(record)}>\n          <div className="archive-ticket-cover"><RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 2)} /></div>\n          <section>\n            <span className="archive-ticket-backdrop" aria-hidden="true"><RecordMedia media={primaryMedia(record)} alt="" fallback="" /></span>\n            <span className="archive-ticket-tint" aria-hidden="true" />\n            <div className="archive-ticket-content"><span>{categoryLabels[record.category]}</span><h3>{record.title}</h3><p>{record.artists.join(" / ") || "艺人待补"}</p><dl><dt>DATE</dt><dd>{record.date}</dd><dt>VENUE</dt><dd>{record.city} · {record.venue}</dd><dt>SEAT</dt><dd>{record.seat || "座位待补"}</dd><dt>PRICE</dt><dd>{record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"}</dd></dl></div>\n          </section>\n        </button>'''
text = replace_once(text, ticket_old, ticket_new, 'frosted archive ticket')

venue_repl = r'''function footprintLngLat(name: string, mode: "city" | "venue", records: EventRecord[]): [number, number] | undefined {
  const record = records.find((item) => mode === "city"
    ? item.city === name
    : [item.city, item.venue].filter(Boolean).join(" · ") === name);
  if (!record) return undefined;
  return record.coordinates
    ? [record.coordinates.lng, record.coordinates.lat]
    : cityCoordinateFallbacks[record.city];
}

function VenueView({ records, mapSettings, onOpenMapSettings, onOpen }: { records: EventRecord[]; mapSettings: AppSettings["map"]; onOpenMapSettings: () => void; onOpen: (record: EventRecord) => void }) {
  const [mode, setMode] = useState<"city" | "venue">("city");
  const rows = mode === "city"
    ? topRows(records.map((record) => record.city).filter(Boolean), 30)
    : topRows(records.map((record) => [record.city, record.venue].filter(Boolean).join(" · ")).filter(Boolean), 30);
  const max = Math.max(1, ...rows.map(([, count]) => count));

  let mapPanel: ReactNode;
  if (mapSettings.provider === "amap" && !mapSettings.amapKey.trim()) {
    mapPanel = <div className="venue-map-state" data-map-mode="amap-missing-key"><MapIcon /><strong>配置高德 Key 后显示真实足迹底图</strong><p>你已经选择高德地图，但当前设备没有可用的 Web 端 JS API Key。</p><button type="button" onClick={onOpenMapSettings}>配置高德 Key</button></div>;
  } else if (mapSettings.provider === "amap") {
    mapPanel = <AmapFootprintMap records={records} rows={rows} mode={mode} mapSettings={mapSettings} onOpen={onOpen} />;
  } else if (mapSettings.provider === "baidu") {
    mapPanel = <div className="venue-map-state" data-map-mode="baidu-not-ready"><MapIcon /><strong>百度地图尚未接入当前足迹视图</strong><p>为避免“切换了但底图没变化”的假状态，这里不再回退到其他地图。</p><button type="button" onClick={onOpenMapSettings}>切换地图来源</button></div>;
  } else {
    mapPanel = <div className="venue-map-art venue-offline-summary" data-map-mode="offline-summary"><div className="venue-map-heading"><span>MEMORY PLACES</span><strong>离线城市摘要</strong><small>无需 API · 只显示已记录城市，不模拟行政边界</small></div><div className="venue-offline-grid">{rows.slice(0, 18).map(([name, count]) => <button key={name} type="button" style={{ "--weight": count / max } as CSSProperties} onClick={() => { const record = records.find((item) => mode === "city" ? item.city === name : [item.city, item.venue].filter(Boolean).join(" · ") === name); if (record) onOpen(record); }}><b>{name}</b><span>{count} 场</span></button>)}</div><button className="venue-enable-map" type="button" onClick={onOpenMapSettings}>启用高德地图</button></div>;
  }

  return (
    <section className="archive-venue-view">
      {mapPanel}
      <div className="venue-ranking"><header><span>足迹整理</span><h2>{mode === "city" ? "常去城市" : "常去场馆"}</h2><div><button className={mode === "city" ? "is-active" : ""} type="button" onClick={() => setMode("city")}>城市</button><button className={mode === "venue" ? "is-active" : ""} type="button" onClick={() => setMode("venue")}>场馆</button></div></header>{rows.map(([name, count]) => <p key={name} style={{ "--ratio": `${count / max * 100}%` } as CSSProperties}><span>{name}</span><i /><b>{count}</b></p>)}</div>
    </section>
  );
}

function AmapFootprintMap({ records, rows, mode, mapSettings, onOpen }: { records: EventRecord[]; rows: [string, number][]; mode: "city" | "venue"; mapSettings: AppSettings["map"]; onOpen: (record: EventRecord) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    let instance: { destroy: () => void; add?: (items: unknown) => void; setFitView?: (...args: unknown[]) => void } | null = null;
    setStatus("loading");
    loadAmap({ key: mapSettings.amapKey, securityCode: mapSettings.amapSecurityCode })
      .then((AMap) => {
        if (disposed || !hostRef.current) return;
        instance = new AMap.Map(hostRef.current, { center: [104.2, 35.8], zoom: 4.1, viewMode: "2D", resizeEnable: true });
        const markers = rows.slice(0, 30).flatMap(([name, count]) => {
          const point = footprintLngLat(name, mode, records);
          if (!point) return [];
          const record = records.find((item) => mode === "city" ? item.city === name : [item.city, item.venue].filter(Boolean).join(" · ") === name);
          const marker = new AMap.Marker({ position: point, title: `${name} · ${count} 场` });
          if (record) marker.on?.("click", () => onOpen(record));
          return [marker];
        });
        instance.add?.(markers);
        if (markers.length) instance.setFitView?.(markers, false, [70, 70, 70, 70], 11);
        hostRef.current.dataset.amapReady = "true";
        setStatus("ready");
      })
      .catch(() => { if (!disposed) setStatus("error"); });
    return () => {
      disposed = true;
      instance?.destroy();
    };
  }, [mapSettings.amapKey, mapSettings.amapSecurityCode, mode, onOpen, records, rows]);

  return <div className="amap-map-shell" data-map-mode="amap"><div className="venue-map-heading"><span>AMAP · MEMORY MAP</span><strong>高德现场足迹</strong><small>{status === "ready" ? "已按档案坐标标出演出地点" : status === "error" ? "地图加载失败，请检查 Key、安全密钥或域名白名单" : "正在载入高德地图…"}</small></div><div ref={hostRef} className="amap-map-host" data-amap-status={status} />{status === "error" ? <button className="venue-enable-map" type="button" onClick={() => window.location.reload()}>重新载入</button> : null}</div>;
}
'''
text = regex_once(text, r'// Simplified from Natural Earth 1:110m public-domain country geometry\.[\s\S]*?\nfunction PriceView', venue_repl + '\n\nfunction PriceView', 'replace fixed China map with provider map')
write(path, text)

# ── archive.css ─────────────────────────────────────────────────
path = "src/archive.css"
text = read(path)
css = r'''

/* Dense, gap-minimizing picture-book flow. */
.archive-showcase {
  display: block;
  columns: 4 220px;
  column-gap: 8px;
}
.archive-showcase-density-2 { column-count: 2; }
.archive-showcase-density-3 { column-count: 3; }
.archive-showcase-density-4 { column-count: 4; }
.archive-showcase-density-5 { column-count: 5; }
.archive-showcase .showcase-card {
  display: inline-block;
  width: 100%;
  height: auto;
  margin: 0 0 8px;
  break-inside: avoid;
  vertical-align: top;
}
.archive-showcase .showcase-card > button { position: absolute; inset: 0; }

/* Poster-derived frosted ticket surface. */
.archive-ticket { position: relative; isolation: isolate; background: linear-gradient(135deg, var(--tone-a, #172229), var(--tone-b, #47645d)); }
.archive-ticket > section { overflow: hidden; isolation: isolate; background: color-mix(in srgb, var(--experience-surface-solid) 50%, transparent); }
.archive-ticket-backdrop { position: absolute; inset: -26px; z-index: -4; display: block; overflow: hidden; opacity: .62; filter: blur(24px) saturate(1.2); transform: scale(1.14); }
.archive-ticket-backdrop img, .archive-ticket-backdrop > span { width: 100%; height: 100%; object-fit: cover; }
.archive-ticket-tint { position: absolute; inset: 0; z-index: -3; display: block; background: linear-gradient(125deg, color-mix(in srgb, var(--tone-a) 88%, transparent), color-mix(in srgb, var(--tone-b) 72%, rgba(255,255,255,.22))); }
.archive-ticket-content { position: relative; z-index: 1; min-height: 100%; padding: 10px 11px; border: 1px solid color-mix(in srgb, white 32%, transparent); border-radius: 13px; background: color-mix(in srgb, var(--experience-surface-solid) 72%, transparent); backdrop-filter: blur(18px) saturate(1.08); }
.archive-ticket-content > span { color: #108879; font-size: 10px; font-weight: 950; }
.archive-ticket-content dl { margin-top: 10px; }

/* Provider-specific venue map states. */
.amap-map-shell, .venue-map-state, .venue-offline-summary { min-height: 440px; border: 1px solid var(--experience-border); border-radius: var(--experience-radius); background: var(--experience-surface); box-shadow: var(--experience-shadow); overflow: hidden; }
.amap-map-shell { position: relative; }
.amap-map-host { width: 100%; height: 440px; background: color-mix(in srgb, var(--experience-surface-solid) 86%, #dce7e2); }
.amap-map-shell .venue-map-heading { position: absolute; top: 14px; left: 14px; z-index: 4; max-width: min(360px, calc(100% - 28px)); padding: 10px 12px; border: 1px solid var(--experience-border); border-radius: 12px; background: color-mix(in srgb, var(--experience-surface-solid) 84%, transparent); backdrop-filter: blur(14px); }
.venue-map-state { display: grid; place-items: center; align-content: center; gap: 9px; padding: 34px; text-align: center; }
.venue-map-state svg { width: 34px; height: 34px; color: #108879; }
.venue-map-state strong { font-size: 20px; }
.venue-map-state p { max-width: 520px; margin: 0; color: var(--experience-muted); font-size: 12px; font-weight: 780; line-height: 1.65; }
.venue-map-state button, .venue-enable-map { min-height: 36px; padding: 0 14px; border: 1px solid var(--experience-border); border-radius: 9px; color: inherit; background: var(--experience-surface-solid); font-weight: 900; cursor: pointer; }
.venue-offline-summary { display: grid; grid-template-rows: auto 1fr auto; gap: 18px; padding: 22px; }
.venue-offline-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; align-content: start; }
.venue-offline-grid button { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border: 1px solid var(--experience-border); border-radius: 10px; color: inherit; background: linear-gradient(135deg, color-mix(in srgb, var(--experience-accent-2) calc(8% + var(--weight) * 18%), var(--experience-surface-solid)), var(--experience-surface-solid)); cursor: pointer; }
.venue-offline-grid b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.venue-offline-grid span { color: var(--experience-muted); font-size: 10px; font-weight: 900; white-space: nowrap; }

@media (max-width: 760px) {
  .archive-showcase, .archive-showcase-density-2, .archive-showcase-density-3, .archive-showcase-density-4, .archive-showcase-density-5 { column-count: 2; column-gap: 6px; }
  .archive-showcase .showcase-card { margin-bottom: 6px; }
  .amap-map-shell, .venue-map-state, .venue-offline-summary { min-height: 360px; }
  .amap-map-host { height: 360px; }
  .venue-offline-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
'''
if '/* Dense, gap-minimizing picture-book flow. */' not in text:
    text += css
write(path, text)

# ── amap loader ─────────────────────────────────────────────────
amap = r'''export interface AMapMarkerInstance {
  on?: (event: string, handler: () => void) => void;
}

export interface AMapMapInstance {
  add?: (items: AMapMarkerInstance[] | AMapMarkerInstance) => void;
  setFitView?: (...args: unknown[]) => void;
  destroy: () => void;
}

export interface AMapNamespace {
  Map: new (container: HTMLElement | string, options?: Record<string, unknown>) => AMapMapInstance;
  Marker: new (options?: Record<string, unknown>) => AMapMarkerInstance;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

let pending: Promise<AMapNamespace> | null = null;
let pendingKey = "";

export function loadAmap({ key, securityCode = "" }: { key: string; securityCode?: string }) {
  const trimmedKey = key.trim();
  if (!trimmedKey) return Promise.reject(new Error("AMap key is required"));
  if (typeof window === "undefined") return Promise.reject(new Error("AMap requires a browser"));
  if (window.AMap) return Promise.resolve(window.AMap);
  if (pending && pendingKey === trimmedKey) return pending;

  if (securityCode.trim()) {
    window._AMapSecurityConfig = { ...(window._AMapSecurityConfig || {}), securityJsCode: securityCode.trim() };
  }
  pendingKey = trimmedKey;
  pending = new Promise<AMapNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-live-memory-amap="1"]');
    const script = existing || document.createElement("script");
    const finish = () => {
      if (window.AMap) resolve(window.AMap);
      else {
        pending = null;
        reject(new Error("AMap loaded without a global namespace"));
      }
    };
    const fail = () => {
      pending = null;
      reject(new Error("AMap script failed to load"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.dataset.liveMemoryAmap = "1";
      script.async = true;
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(trimmedKey)}`;
      document.head.appendChild(script);
    }
  });
  return pending;
}
'''
write("src/amap.ts", amap)

# ── appController.ts ────────────────────────────────────────────
path = "src/appController.ts"
text = read(path)
text = replace_once(text, 'const MEDIA_REFRESH_EVENT = "live-memory:cloud-media-refresh";', 'const MEDIA_REFRESH_EVENT = "live-memory:cloud-media-refresh";\nconst REMOTE_CHECK_INTERVAL = 5 * 60 * 1000;', 'remote interval')
text = replace_once(text, '  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);\n  const [busy, setBusy] = useState(false);', '  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);\n  const [cloudRecoveryNotice, setCloudRecoveryNotice] = useState("");\n  const [busy, setBusy] = useState(false);', 'cloud recovery state')
text = replace_once(text, '  const lastMediaRefreshAt = useRef(0);', '  const lastMediaRefreshAt = useRef(0);\n  const lastRemoteCheckAt = useRef(0);\n  const syncOperationInFlight = useRef(false);', 'cloud refs')
text = replace_once(text, '        recordsRef.current = nextRecords;\n        setRecordState(nextRecords);\n        setSettings(nextSettings);', '        const loadedActiveCount = loadedRecords.filter((record) => !record.deletedAt).length;\n        const nextActiveCount = nextRecords.filter((record) => !record.deletedAt).length;\n        recordsRef.current = nextRecords;\n        setRecordState(nextRecords);\n        setSettings(nextSettings);\n        if (access.user && nextActiveCount > loadedActiveCount) setCloudRecoveryNotice(`已从云端恢复 ${nextActiveCount - loadedActiveCount} 条其他设备记录，可直接刷新云端图片。`);', 'initial recovery notice')
text = replace_once(text, 'if (!initialized.current || isGuest || !access.user || editing || syncing || records.length === 0) return;', 'if (!initialized.current || isGuest || !access.user || editing || syncing || syncOperationInFlight.current || records.length === 0) return;', 'auto sync concurrency guard')
text = replace_once(text, '      lastSyncFingerprint.current = fingerprint;\n      setSyncing(true);', '      lastSyncFingerprint.current = fingerprint;\n      syncOperationInFlight.current = true;\n      setSyncing(true);', 'auto sync set guard')
text = replace_once(text, '        .finally(() => setSyncing(false));', '        .finally(() => { syncOperationInFlight.current = false; setSyncing(false); });', 'auto sync release guard')

pageview_anchor = '''  useEffect(() => {\n    if (isGuest || !access.user || !hasAccountCloudConfig(settings)) return;\n    recordPageView(route, document.referrer || undefined).catch(() => undefined);\n  }, [access.user, isGuest, route, settings]);\n'''
remote_effect = '''  useEffect(() => {\n    if (isGuest || !access.user || (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings))) return;\n    const check = () => { if (document.visibilityState === "visible") void checkRemoteUpdates(true); };\n    const initial = window.setTimeout(check, 1800);\n    const interval = window.setInterval(check, REMOTE_CHECK_INTERVAL);\n    const onVisible = () => { if (document.visibilityState === "visible") check(); };\n    const onOnline = () => void checkRemoteUpdates(false);\n    window.addEventListener("focus", check);\n    window.addEventListener("online", onOnline);\n    document.addEventListener("visibilitychange", onVisible);\n    return () => {\n      window.clearTimeout(initial);\n      window.clearInterval(interval);\n      window.removeEventListener("focus", check);\n      window.removeEventListener("online", onOnline);\n      document.removeEventListener("visibilitychange", onVisible);\n    };\n  }, [access.user, isGuest, settings.accountBackup.enabled, settings.supabase.ownerKey, settings.supabase.url]);\n\n'''
text = replace_once(text, pageview_anchor, remote_effect + pageview_anchor, 'proactive remote check effect')

persist_anchor = '  async function persistRecord(record: EventRecord) {'
cloud_functions = '''  async function runCloudSync(label: string, silent = false) {\n    if (isGuest) { if (!silent) flash("示例模式无需云同步"); return false; }\n    if (!access.user || (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings))) { if (!silent) flash("尚未连接可用云端"); return false; }\n    if (syncOperationInFlight.current) return false;\n    syncOperationInFlight.current = true;\n    setSyncing(true);\n    const before = recordFingerprint(recordsRef.current);\n    try {\n      const result = await autoSyncAll(settings, recordsRef.current);\n      setSyncConflicts(result.conflicts);\n      const changed = recordFingerprint(result.records) !== before || mediaFingerprint(result.records) !== mediaFingerprint(recordsRef.current);\n      if (changed) {\n        await replaceAllRecords(result.records);\n        setRecords(result.records);\n        void preloadRecordMedia(result.records);\n      }\n      const syncedSettings = writeSettings({ ...settings, lastSyncAt: nowIso() });\n      setSettings(syncedSettings);\n      lastSyncFingerprint.current = autoSyncFingerprint(result.records, syncedSettings);\n      if (!silent) flash(changed ? `${label}：已合并其他设备更新` : `${label}：当前已是最新`);\n      return changed;\n    } catch (error) {\n      if (!silent) flash(friendlySupabaseErrorMessage(error, `${label}失败`));\n      return false;\n    } finally {\n      syncOperationInFlight.current = false;\n      setSyncing(false);\n    }\n  }\n\n  async function syncNow() {\n    return runCloudSync("立即同步");\n  }\n\n  async function checkRemoteUpdates(silent = false) {\n    if (silent && lastRemoteCheckAt.current && Date.now() - lastRemoteCheckAt.current < REMOTE_CHECK_INTERVAL) return false;\n    lastRemoteCheckAt.current = Date.now();\n    const changed = await runCloudSync("检查其他设备更新", silent);\n    if (changed && silent) flash("已自动合并其他设备的新记录");\n    return changed;\n  }\n\n  async function refreshCloudMedia() {\n    if (isGuest) { flash("示例模式没有云端图片"); return false; }\n    if (!hasPersonalCloudConnection(settings) || !settings.supabase.syncMedia) { flash("当前未开启个人云端图片同步"); return false; }\n    if (mediaRefreshInFlight.current) return false;\n    mediaRefreshInFlight.current = true;\n    const snapshot = recordsRef.current;\n    const before = mediaFingerprint(snapshot);\n    try {\n      const next = await refreshSignedMediaUrls(settings, snapshot, { force: true });\n      void preloadRecordMedia(next);\n      lastMediaRefreshAt.current = Date.now();\n      if (mediaFingerprint(next) !== before) {\n        await replaceAllRecords(next);\n        setRecords(next);\n      }\n      flash("云端图片链接已刷新");\n      return true;\n    } catch (error) {\n      flash(friendlySupabaseErrorMessage(error, "云端图片刷新失败"));\n      return false;\n    } finally {\n      mediaRefreshInFlight.current = false;\n    }\n  }\n\n'''
text = replace_once(text, persist_anchor, cloud_functions + persist_anchor, 'explicit cloud actions')
text = replace_once(text, '    syncConflicts,\n    setSyncConflicts,', '    syncConflicts,\n    setSyncConflicts,\n    cloudRecoveryNotice,\n    dismissCloudRecoveryNotice: () => setCloudRecoveryNotice(""),\n    syncNow,\n    checkRemoteUpdates,\n    refreshCloudMedia,', 'controller return cloud actions')
write(path, text)

# ── AppRoot.tsx ─────────────────────────────────────────────────
path = "src/AppRoot.tsx"
text = read(path)
text = replace_once(text, '  Cloud,\n  Import,', '  Cloud,\n  CloudDownload,\n  ChevronDown,\n  Import,', 'root cloud imports')
text = replace_once(text, '  Loader2,\n  Plus,', '  Loader2,\n  Plus,\n  RefreshCw,', 'root refresh import')
text = replace_once(text, '    syncing,\n    syncConflicts,\n    setSyncConflicts,', '    syncing,\n    syncConflicts,\n    setSyncConflicts,\n    cloudRecoveryNotice,\n    dismissCloudRecoveryNotice,\n    syncNow,\n    checkRemoteUpdates,\n    refreshCloudMedia,', 'root controller destructure')
text = replace_once(text, '  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);', '  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);\n  const [syncMenuOpen, setSyncMenuOpen] = useState(false);', 'sync menu state')

old_utility = '''      <span className={`sync-pill${syncing ? " syncing" : ""}`}>\n        {syncing ? <Loader2 className="spin" /> : syncConflicts.length ? <AlertTriangle /> : <Cloud />}\n        {syncLabel}\n      </span>'''
new_utility = '''      <div className="sync-action-wrap">\n        <button className={`sync-pill${syncing ? " syncing" : ""}`} type="button" aria-expanded={syncMenuOpen} onClick={() => setSyncMenuOpen((value) => !value)}>\n          {syncing ? <Loader2 className="spin" /> : syncConflicts.length ? <AlertTriangle /> : <Cloud />}\n          <span>{syncLabel}</span><ChevronDown />\n        </button>\n        {syncMenuOpen && (\n          <div className="sync-action-menu" role="dialog" aria-label="云同步中心">\n            <header><strong>云同步中心</strong><small>{settings.lastSyncAt ? `最近同步 ${new Date(settings.lastSyncAt).toLocaleString()}` : "尚未完成同步"}</small></header>\n            <button type="button" disabled={syncing || isGuest} onClick={() => void syncNow()}><Cloud />立即同步</button>\n            <button type="button" disabled={syncing || isGuest} onClick={() => void checkRemoteUpdates(false)}><CloudDownload />从云端恢复 / 检查其他设备更新</button>\n            <button type="button" disabled={syncing || isGuest || !settings.supabase.syncMedia} onClick={() => void refreshCloudMedia()}><RefreshCw />刷新云端图片</button>\n            <small>{settings.supabase.syncMedia ? "图片同步已开启；网页恢复可见和网络恢复时也会自动刷新。" : "当前未开启云端图片同步。"}</small>\n          </div>\n        )}\n      </div>'''
text = replace_once(text, old_utility, new_utility, 'global sync menu')

children_anchor = '''    >\n      {route === "archive" && ('''
recovery_banner = '''    >\n      {cloudRecoveryNotice && !isGuest && (\n        <div className="cloud-recovery-banner"><CloudDownload /><span><strong>其他设备的数据已经到达这台设备</strong><small>{cloudRecoveryNotice}</small></span><button type="button" onClick={() => void refreshCloudMedia()}>刷新图片</button><button type="button" aria-label="关闭云端恢复提示" onClick={dismissCloudRecoveryNotice}>×</button></div>\n      )}\n      {route === "archive" && ('''
text = replace_once(text, children_anchor, recovery_banner, 'cloud recovery banner')
text = replace_once(text, '          onZoom={setZoomMedia}\n        />', '          onZoom={setZoomMedia}\n          onOpenMapSettings={() => setRoute("settings")}\n        />', 'map settings callback')
write(path, text)

# ── base.css ────────────────────────────────────────────────────
path = "src/base.css"
text = read(path)
css = r'''

.sync-action-wrap { position: relative; }
.sync-pill { cursor: pointer; }
.sync-pill > span { overflow: hidden; max-width: 150px; text-overflow: ellipsis; }
.sync-pill > svg:last-child { width: 13px; height: 13px; color: currentColor; opacity: .62; }
.sync-action-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 180; display: grid; width: min(340px, calc(100vw - 24px)); gap: 6px; padding: 10px; border: 1px solid var(--experience-border); border-radius: 12px; color: var(--experience-text); background: color-mix(in srgb, var(--experience-surface-solid) 94%, transparent); box-shadow: 0 20px 50px color-mix(in srgb, var(--experience-text) 18%, transparent); backdrop-filter: blur(20px); }
.sync-action-menu header { display: grid; gap: 2px; padding: 3px 4px 7px; }
.sync-action-menu header strong { font-size: 13px; }
.sync-action-menu header small, .sync-action-menu > small { color: var(--experience-muted); font-size: 9px; font-weight: 780; line-height: 1.45; }
.sync-action-menu > button { display: flex; min-height: 38px; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--experience-border); border-radius: 9px; color: inherit; text-align: left; background: var(--experience-surface-solid); font-size: 11px; font-weight: 900; cursor: pointer; }
.sync-action-menu > button:disabled { cursor: not-allowed; opacity: .46; }
.sync-action-menu > button svg { width: 15px; height: 15px; color: #108879; }
.cloud-recovery-banner { display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; gap: 10px; align-items: center; margin: 0 0 10px; padding: 10px 12px; border: 1px solid color-mix(in srgb, #108879 32%, var(--experience-border)); border-radius: 11px; background: color-mix(in srgb, var(--experience-accent-2) 11%, var(--experience-surface-solid)); }
.cloud-recovery-banner > svg { width: 20px; height: 20px; color: #108879; }
.cloud-recovery-banner span { min-width: 0; }
.cloud-recovery-banner strong, .cloud-recovery-banner small { display: block; }
.cloud-recovery-banner strong { font-size: 12px; }
.cloud-recovery-banner small { margin-top: 2px; color: var(--experience-muted); font-size: 10px; font-weight: 780; }
.cloud-recovery-banner button { min-height: 32px; padding: 0 10px; border: 1px solid var(--experience-border); border-radius: 8px; color: inherit; background: var(--experience-surface-solid); font-weight: 900; cursor: pointer; }
@media (max-width: 700px) { .sync-action-menu { position: fixed; top: auto; right: 8px; bottom: 74px; left: 8px; width: auto; } .cloud-recovery-banner { grid-template-columns: auto minmax(0,1fr) auto; } .cloud-recovery-banner > button:first-of-type { grid-column: 2 / 4; } }
'''
if '.sync-action-wrap {' not in text:
    text += css
write(path, text)

# ── settings copy ───────────────────────────────────────────────
path = "src/settingsPage.tsx"
text = read(path)
text = text.replace('中国固定足迹图无需 API；高德或百度在线地图需要各自的浏览器端密钥。', '离线城市摘要无需 API；高德地图会真实加载 JS API，百度暂未接入足迹视图。')
text = text.replace('<option value="none">中国固定足迹图（无需 API）</option>', '<option value="none">离线城市摘要（无需 API）</option>')
write(path, text)

# ── existing tests updated for new architecture ─────────────────
path = "scripts/run-tests.mjs"
text = read(path)
text = text.replace('ShareLayout = "wall" \\| "timeline" \\| "magazine" \\| "cities"', 'ShareLayout = "wall" \\| "tickets" \\| "timeline" \\| "magazine" \\| "cities"')
write(path, text)

path = "scripts/share-studio-adaptive-tests.mjs"
text = read(path)
text = text.replace('assert.match(settings, /中国固定足迹图（无需 API）/);', 'assert.match(settings, /离线城市摘要（无需 API）/);')
write(path, text)

static_test = r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
const archiveCss = await readFile(new URL("../src/archive.css", import.meta.url), "utf8");
const amap = await readFile(new URL("../src/amap.ts", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");

assert.match(archive, /mapSettings/);
assert.match(archive, /provider === "amap"/);
assert.match(archive, /data-map-mode="amap-missing-key"/);
assert.match(archive, /data-map-mode="baidu-not-ready"/);
assert.match(archive, /data-map-mode="offline-summary"/);
assert.match(archive, /amap-map-host/);
assert.doesNotMatch(archive, /china-map-land|chinaOutlineCoordinates|projectChinaCoordinate/);
assert.match(amap, /webapi\.amap\.com\/maps\?v=2\.0/);
assert.match(amap, /_AMapSecurityConfig/);
assert.match(amap, /data-live-memory-amap/);
assert.match(archiveCss, /\.amap-map-host/);
assert.match(settings, /离线城市摘要（无需 API）/);

console.log("Provider-driven archive map contracts passed.");
'''
write("scripts/static-china-map-tests.mjs", static_test)

# ── visual audit: replace obsolete static map and add new views ──
path = "scripts/visual-audit.mjs"
text = read(path)
old_map = '''await archiveView("城市/场馆", ".archive-venue-view");\nawait page.locator(".china-static-map .china-map-land").first().waitFor({ state: "visible", timeout: 10000 });\nconst staticChinaMap = await page.locator(".venue-map-art").evaluate((map) => {\n  const land = map.querySelector(".china-map-land");\n  const rect = map.getBoundingClientRect();\n  const landStyle = land ? getComputedStyle(land) : null;\n  return {\n    mode: map.getAttribute("data-map-mode"),\n    width: rect.width,\n    height: rect.height,\n    landFill: landStyle?.fill || "",\n    landStroke: landStyle?.stroke || "",\n    markerCount: map.querySelectorAll(".venue-map-marker").length,\n  };\n});\nif (staticChinaMap.mode !== "static-china" || staticChinaMap.width < 500 || staticChinaMap.height < 340 || !staticChinaMap.landFill || staticChinaMap.landFill === "rgb(16, 20, 24)" || staticChinaMap.markerCount < 1) {\n  throw new Error(`Fixed China footprint map is invalid: ${JSON.stringify(staticChinaMap)}`);\n}\nawait page.screenshot({ path: `${outputDir}/05b-static-china-map.png`, fullPage: true });'''
new_map = '''await archiveView("城市/场馆", ".archive-venue-view");\nawait page.locator('[data-map-mode="offline-summary"]').waitFor({ state: "visible", timeout: 10000 });\nconst offlineMap = await page.locator('[data-map-mode="offline-summary"]').evaluate((map) => ({\n  width: map.getBoundingClientRect().width,\n  height: map.getBoundingClientRect().height,\n  itemCount: map.querySelectorAll(".venue-offline-grid button").length,\n  hasChinaPolygon: Boolean(map.querySelector(".china-map-land, .china-static-map")),\n}));\nif (offlineMap.width < 500 || offlineMap.height < 300 || offlineMap.itemCount < 1 || offlineMap.hasChinaPolygon) {\n  throw new Error(`Offline city summary is invalid: ${JSON.stringify(offlineMap)}`);\n}\nawait page.screenshot({ path: `${outputDir}/05b-offline-city-summary.png`, fullPage: true });'''
text = replace_once(text, old_map, new_map, 'visual map audit')

share_anchor = '''  const activeFormat = await page.locator(".share-format-control button.is-active").innerText();\n  if (!activeFormat.includes("智能横版")) throw new Error(`Share studio did not open in smart landscape mode: ${activeFormat}`);'''
share_add = '''  const activeFormat = await page.locator(".share-format-control button.is-active").innerText();\n  if (!activeFormat.includes("智能横版")) throw new Error(`Share studio did not open in smart landscape mode: ${activeFormat}`);\n  const activeLimit = await page.locator(".share-count-control button.is-active").innerText();\n  if (!activeLimit.includes("全部")) throw new Error(`Share studio should default to all records, got: ${activeLimit}`);'''
text = replace_once(text, share_anchor, share_add, 'visual default all check')

wall_anchor = '''  await page.screenshot({ path: `${outputDir}/06-share-wall-fit.png`, fullPage: true });\n\n  await page.locator(".share-format-control button").filter({ hasText: "智能竖版" }).click();'''
ticket_visual = '''  await page.screenshot({ path: `${outputDir}/06-share-wall-fit.png`, fullPage: true });\n\n  await layoutButton("票根聚合").click();\n  await page.locator(".share-ticket-card").first().waitFor({ state: "visible", timeout: 10000 });\n  const ticketShareGeometry = await page.locator(".share-layout-canvas-tickets").evaluate((canvas) => ({\n    cardCount: canvas.querySelectorAll(".share-ticket-card").length,\n    backdropCount: canvas.querySelectorAll(".share-ticket-backdrop").length,\n    overflow: getComputedStyle(canvas).overflow,\n  }));\n  if (ticketShareGeometry.cardCount < 3 || ticketShareGeometry.backdropCount !== ticketShareGeometry.cardCount) throw new Error(`Ticket share layout is incomplete: ${JSON.stringify(ticketShareGeometry)}`);\n  await assertFixedPreviewFits("Ticket aggregation");\n  await page.screenshot({ path: `${outputDir}/06b-share-ticket-aggregation.png`, fullPage: true });\n  await layoutButton("密集海报墙").click();\n\n  await page.locator(".share-format-control button").filter({ hasText: "智能竖版" }).click();'''
text = replace_once(text, wall_anchor, ticket_visual, 'visual ticket share')

# Add sync menu + showcase checks after ticket screenshot, before list view.
ticket_anchor = '''  await page.screenshot({ path: `${outputDir}/04-ticket-desktop.png`, fullPage: true });\n  await archiveView("列表", ".archive-list button");'''
extra_archive = '''  const frostedTicket = await page.locator(".archive-ticket").first().evaluate((card) => ({\n    backdrop: Boolean(card.querySelector(".archive-ticket-backdrop")),\n    blur: getComputedStyle(card.querySelector(".archive-ticket-backdrop")).filter,\n    glass: getComputedStyle(card.querySelector(".archive-ticket-content")).backdropFilter,\n  }));\n  if (!frostedTicket.backdrop || !frostedTicket.blur.includes("blur") || !frostedTicket.glass.includes("blur")) throw new Error(`Ticket is not frosted from its poster: ${JSON.stringify(frostedTicket)}`);\n  await page.screenshot({ path: `${outputDir}/04-ticket-desktop.png`, fullPage: true });\n  await archiveView("画报", ".showcase-card");\n  const showcase = await page.locator(".archive-showcase").evaluate((node) => ({ display: getComputedStyle(node).display, columnCount: getComputedStyle(node).columnCount, gap: getComputedStyle(node).columnGap }));\n  if (showcase.display !== "block" || Number(showcase.columnCount) < 2 || parseFloat(showcase.gap) > 10) throw new Error(`Showcase is not using compact columns: ${JSON.stringify(showcase)}`);\n  await page.screenshot({ path: `${outputDir}/04b-showcase-dense.png`, fullPage: true });\n  await page.locator(".sync-pill").click();\n  await page.locator(".sync-action-menu").waitFor({ state: "visible", timeout: 5000 });\n  const syncMenuText = await page.locator(".sync-action-menu").innerText();\n  for (const label of ["立即同步", "从云端恢复", "刷新云端图片"]) if (!syncMenuText.includes(label)) throw new Error(`Sync menu is missing ${label}`);\n  await page.locator(".sync-pill").click();\n  await archiveView("列表", ".archive-list button");'''
text = replace_once(text, ticket_anchor, extra_archive, 'visual archive enhancements')
write(path, text)

print("Applied archive experience redesign")
