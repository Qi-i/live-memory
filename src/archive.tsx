import {
  Archive,
  CalendarDays,
  ChevronDown,
  Copy,
  CircleDollarSign,
  Eye,
  Filter,
  ImagePlus,
  List,
  Map as MapIcon,
  Pencil,
  Search,
  Share2,
  Sparkles,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import {
  CSSProperties,
  Dispatch,
  MouseEvent,
  ReactNode,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AppSettings,
  ArchiveView,
  EventCategory,
  EventRecord,
  EventStatus,
  Filters,
  MediaAsset,
} from "./domain";
import { ShareStudio, type ShareFormat } from "./shareStudio";
import { loadMediaImage, resolveMediaSource, useCachedMediaSrc } from "./mediaCache";
import { loadAmap, type AMapMapInstance } from "./amap";
import "./archiveContextMenu.css";
export type { ShareFormat } from "./shareStudio";
import {
  categoryLabels,
  daysFromToday,
  effectiveStatus,
  formatDateCn,
  formatRelativeDay,
  primaryMedia,
  statusLabels,
} from "./domain";

export type ArchiveLayout = ArchiveView | "showcase";

const emptyFilters: Filters = {
  query: "",
  categories: [],
  statuses: [],
  years: [],
  cities: [],
  artists: [],
  tags: [],
};

const layoutGroups: Array<{ label: string; items: Array<{ value: ArchiveLayout; label: string; icon: ReactNode }> }> = [
  {
    label: "视觉",
    items: [
      { value: "poster", label: "海报", icon: <ImagePlus /> },
      { value: "showcase", label: "画报", icon: <Sparkles /> },
      { value: "wallet", label: "票夹", icon: <Archive /> },
      { value: "ticket", label: "票根", icon: <Ticket /> },
    ],
  },
  {
    label: "组织",
    items: [
      { value: "timeline", label: "时间线", icon: <ChevronDown /> },
      { value: "calendar", label: "日历", icon: <CalendarDays /> },
      { value: "venue", label: "城市/场馆", icon: <MapIcon /> },
      { value: "list", label: "列表", icon: <List /> },
    ],
  },
  {
    label: "分析",
    items: [
      { value: "price", label: "票价", icon: <CircleDollarSign /> },
      { value: "summary", label: "汇总", icon: <Sparkles /> },
    ],
  },
];

export interface ArchivePageProps {
  records: EventRecord[];
  settings: AppSettings;
  layout: ArchiveLayout;
  setLayout: (layout: ArchiveLayout) => void;
  shareMode: boolean;
  setShareMode: (value: boolean) => void;
  shareFormat: ShareFormat;
  setShareFormat: (value: ShareFormat) => void;
  onOpen: (record: EventRecord) => void;
  onEdit: (record: EventRecord) => void;
  onDuplicate: (record: EventRecord) => void;
  onDelete: (record: EventRecord) => void;
  onZoom: (media: MediaAsset) => void;
  onOpenMapSettings: () => void;
}

export function ArchivePage({
  records,
  settings,
  layout,
  setLayout,
  shareMode,
  setShareMode,
  shareFormat,
  setShareFormat,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onZoom,
  onOpenMapSettings,
}: ArchivePageProps) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<"smart" | "date-desc" | "date-asc" | "price-desc" | "updated-desc">("smart");
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ record: EventRecord; x: number; y: number } | null>(null);
  const preferredPosterColumns = Math.min(8, Math.max(5, settings.posterColumns || 5));
  const [density, setDensity] = useState(preferredPosterColumns);
  const facets = useMemo(() => buildFacets(records), [records]);
  const visibleRecords = useMemo(() => sortRecords(filterRecords(records, filters), sort), [filters, records, sort]);
  const activeFilterCount = filters.categories.length + filters.statuses.length + filters.years.length + filters.cities.length + filters.artists.length + filters.tags.length;

  useEffect(() => {
    const open = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const host = target?.closest<HTMLElement>("[data-archive-record-id]");
      if (!host?.closest(".archive-page")) return;
      const record = records.find((item) => item.id === host.dataset.archiveRecordId);
      if (!record) return;
      event.preventDefault();
      event.stopPropagation();
      const width = 220;
      const height = 222;
      setContextMenu({
        record,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      });
    };
    document.addEventListener("contextmenu", open);
    return () => document.removeEventListener("contextmenu", open);
  }, [records]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".archive-context-menu")) return;
      setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    const closeFromKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeFromKey);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeFromKey);
    };
  }, [contextMenu]);

  if (shareMode) {
    return (
      <ShareStudio
        records={visibleRecords}
        format={shareFormat}
        setFormat={setShareFormat}
        mapSettings={settings.map}
        onOpenMapSettings={onOpenMapSettings}
        onClose={() => setShareMode(false)}
      />
    );
  }

  return (
    <section className="archive-page">
      <header className="archive-masthead">
        <div className="archive-masthead-copy">
          <span>LIVE MEMORY · 我的演出档案</span>
          <h2>每一场现场，<br />都是独一无二的记忆。</h2>
          <p>把看过的演出、留下的票根和走过的城市，整理成一份会继续生长的个人档案。</p>
          <div className="archive-masthead-actions">
            <button type="button" onClick={() => document.querySelector(".archive-command")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Archive />浏览全部档案</button>
            <button type="button" onClick={() => setShareMode(true)}><Share2 />制作分享图</button>
          </div>
          <div className="archive-masthead-stats" aria-label="演出记录摘要">
            <strong>{records.length}<span>全部记录</span></strong>
            <strong>{records.filter((record) => effectiveStatus(record) === "watched").length}<span>已经看过</span></strong>
            <strong>{new Set(records.map((record) => record.city).filter(Boolean)).size}<span>到访城市</span></strong>
          </div>
        </div>
        <ArchiveHighlights records={records} onOpen={onOpen} />
      </header>

      <section className="archive-command" aria-label="档案控制栏">
        <label className="archive-search">
          <Search />
          <input
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="搜索艺人、城市、场馆、标题或标签"
          />
          {filters.query && <button type="button" aria-label="清空搜索" onClick={() => setFilters((current) => ({ ...current, query: "" }))}><X /></button>}
        </label>

        <div className="archive-layout-switch" aria-label="档案视图">
          {layoutGroups.flatMap((group) => group.items).map((item) => (
            <button className={layout === item.value ? "is-active" : ""} key={item.value} type="button" title={item.label} onClick={() => setLayout(item.value)}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="archive-command-actions">
          <button className={expanded ? "is-active" : ""} type="button" onClick={() => setExpanded((value) => !value)}>
            <Filter />
            <span>{activeFilterCount ? `筛选 ${activeFilterCount}` : "筛选"}</span>
          </button>
          <button type="button" onClick={() => setShareMode(true)}>
            <Share2 />
            <span>生成分享图</span>
          </button>
        </div>
      </section>

      {expanded && (
        <section className="archive-filter-panel">
          <FilterChips label="类型" values={filters.categories} options={facets.categories} labels={categoryLabels} onChange={(categories) => setFilters((current) => ({ ...current, categories }))} />
          <FilterChips label="状态" values={filters.statuses} options={facets.statuses} labels={statusLabels} onChange={(statuses) => setFilters((current) => ({ ...current, statuses }))} />
          <StringFilterChips label="年份" values={filters.years} options={facets.years} onChange={(years) => setFilters((current) => ({ ...current, years }))} />
          <StringFilterChips label="城市" values={filters.cities} options={facets.cities} onChange={(cities) => setFilters((current) => ({ ...current, cities }))} />
          <StringFilterChips label="艺人" values={filters.artists} options={facets.artists} onChange={(artists) => setFilters((current) => ({ ...current, artists }))} />
          <div className="archive-filter-footer">
            <label>排序
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="smart">智能排序</option>
                <option value="date-desc">时间最新</option>
                <option value="date-asc">时间最早</option>
                <option value="price-desc">票价最高</option>
                <option value="updated-desc">最近编辑</option>
              </select>
            </label>
            {(layout === "poster" || layout === "showcase") && (
              <label>密度
                <select value={density} onChange={(event) => setDensity(Number(event.target.value))}>
                  {[4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} 列</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={() => setFilters((current) => ({ ...emptyFilters, query: current.query }))}>清空条件</button>
          </div>
        </section>
      )}


      <ArchiveRenderer
        records={visibleRecords}
        layout={layout}
        density={density}
        mapSettings={settings.map}
        onOpenMapSettings={onOpenMapSettings}
        onOpen={onOpen}
        onEdit={onEdit}
        onZoom={onZoom}
      />
      {contextMenu && (
        <div
          className="archive-context-menu"
          role="menu"
          aria-label={`${contextMenu.record.title} 快捷操作`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <header><strong>{contextMenu.record.title}</strong><span>{contextMenu.record.date} · {contextMenu.record.city || contextMenu.record.venue || "演出记录"}</span></header>
          <button role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onOpen(record); }}><Eye />打开</button>
          <button role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onEdit(record); }}><Pencil />编辑</button>
          <button role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onDuplicate(record); }}><Copy />复制为新场次</button>
          <button className="is-danger" role="menuitem" type="button" onClick={() => { const record = contextMenu.record; setContextMenu(null); onDelete(record); }}><Trash2 />删除</button>
        </div>
      )}
    </section>
  );
}

function pickArchiveHighlights(records: EventRecord[], limit = 5) {
  const candidates = [...records]
    .filter((record) => primaryMedia(record))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const selected: EventRecord[] = [];
  const usedArtists = new Set<string>();
  const selectedIds = new Set<string>();
  for (const record of candidates) {
    const artists = record.artists.map((artist) => artist.trim().toLowerCase()).filter(Boolean);
    if (artists.length && artists.some((artist) => usedArtists.has(artist))) continue;
    selected.push(record);
    selectedIds.add(record.id);
    artists.forEach((artist) => usedArtists.add(artist));
    if (selected.length >= limit) return selected;
  }
  for (const record of candidates) {
    if (selectedIds.has(record.id)) continue;
    selected.push(record);
    if (selected.length >= limit) break;
  }
  return selected;
}

function ArchiveHighlights({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const highlights = pickArchiveHighlights(records, 5);
  const featured = highlights[0];
  if (!highlights.length) return <div className="archive-highlight-empty"><span>把第一张演出海报放进来</span><small>这里会自动生成你的精选现场</small></div>;
  return (
    <div className="archive-highlights" aria-label="精选演出海报">
      <span className="archive-highlight-orbit" aria-hidden="true" />
      <div className="archive-highlight-stack">
        {highlights.map((record, index) => (
          <button className={`archive-highlight-card archive-highlight-card-${index + 1}`} data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
            <RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 4)} />
            <span><b>{record.city || categoryLabels[record.category]}</b><small>{record.date.slice(0, 4)}</small></span>
          </button>
        ))}
      </div>
      {featured && (
        <button className="archive-highlight-feature" data-archive-record-id={featured.id} type="button" onClick={() => onOpen(featured)}>
          <span>最近收录</span>
          <strong>{featured.title}</strong>
          <small>{featured.date} · {featured.city || featured.venue || "演出记录"}</small>
        </button>
      )}
    </div>
  );
}

function ArchiveRenderer({
  records,
  layout,
  density,
  mapSettings,
  onOpenMapSettings,
  onOpen,
  onEdit,
  onZoom,
}: {
  records: EventRecord[];
  layout: ArchiveLayout;
  density: number;
  mapSettings: AppSettings["map"];
  onOpenMapSettings: () => void;
  onOpen: (record: EventRecord) => void;
  onEdit: (record: EventRecord) => void;
  onZoom: (media: MediaAsset) => void;
}) {
  if (!records.length) return <ArchiveEmpty />;
  if (layout === "showcase") return <ShowcaseView records={records} density={density} onOpen={onOpen} onZoom={onZoom} />;
  if (layout === "wallet") return <WalletView records={records} onOpen={onOpen} onEdit={onEdit} onZoom={onZoom} />;
  if (layout === "ticket") return <TicketView records={records} onOpen={onOpen} />;
  if (layout === "timeline") return <TimelineView records={records} onOpen={onOpen} />;
  if (layout === "calendar") return <CalendarView records={records} onOpen={onOpen} />;
  if (layout === "venue") return <VenueView records={records} mapSettings={mapSettings} onOpenMapSettings={onOpenMapSettings} onOpen={onOpen} />;
  if (layout === "price") return <PriceView records={records} onOpen={onOpen} />;
  if (layout === "summary") return <SummaryView records={records} />;
  if (layout === "list") return <ListView records={records} onOpen={onOpen} />;
  return <PosterView records={records} density={density} onOpen={onOpen} onZoom={onZoom} />;
}

function PosterView({ records, density, onOpen, onZoom }: { records: EventRecord[]; density: number; onOpen: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  return (
    <section className="archive-poster-grid" style={{ "--archive-columns": density } as CSSProperties}>
      {records.map((record, index) => <PosterCard key={record.id} record={record} index={index} onOpen={onOpen} onZoom={onZoom} />)}
    </section>
  );
}

function archiveArtist(record: EventRecord) {
  return record.artists.join(" / ") || "艺人待补";
}

function archivePrice(record: EventRecord) {
  return record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补";
}

function archiveLocation(record: EventRecord) {
  return [record.city || "城市待补", record.venue || "场馆待补"].join(" · ");
}

function PosterCard({ record, index, onOpen, onZoom }: { record: EventRecord; index: number; onOpen: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  const poster = primaryMedia(record);
  return (
    <article className="archive-poster-card" data-archive-record-id={record.id} onClick={() => onOpen(record)}>
      <span className="archive-rank">#{String(index + 1).padStart(2, "0")}</span>
      <button className="archive-poster-media" type="button" onClick={(event) => { event.stopPropagation(); if (poster) onZoom(poster); else onOpen(record); }}>
        <RecordMedia media={poster} alt={record.title} fallback={record.title.slice(0, 4)} />
      </button>
      <div className="archive-poster-copy">
        <div className="archive-card-kicker"><span>{categoryLabels[record.category]}</span><em>{statusLabels[effectiveStatus(record)]}</em></div>
        <h3>{record.title}</h3>
        <p className="archive-card-artist">{archiveArtist(record)}</p>
        <dl className="archive-card-facts">
          <dt>日期</dt><dd>{formatDateCn(record.date, record.time)}</dd>
          <dt>场馆</dt><dd>{archiveLocation(record)}</dd>
          <dt>票座</dt><dd className="archive-ticket-line"><b>{archivePrice(record)}</b><span>{record.seat || "座位待补"}</span></dd>
        </dl>
      </div>
    </article>
  );
}

function ShowcaseView({ records, density, onOpen, onZoom }: { records: EventRecord[]; density: number; onOpen: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
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
                  <p className="archive-card-artist">{archiveArtist(record)}</p>
                  <small>{record.venue || "场馆待补"} · {archivePrice(record)}</small>
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function WalletView({ records, onOpen, onEdit, onZoom }: { records: EventRecord[]; onOpen: (record: EventRecord) => void; onEdit: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  return (
    <section className="archive-wallet-grid">
      {records.map((record) => {
        const poster = primaryMedia(record);
        return (
          <article className="archive-wallet-card" data-archive-record-id={record.id} key={record.id} style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties}>
            <button className="wallet-cover" type="button" onClick={() => poster ? onZoom(poster) : onOpen(record)}><RecordMedia media={poster} alt={record.title} fallback={record.title.slice(0, 2)} /></button>
            <button className="wallet-copy" type="button" onClick={() => onOpen(record)}>
              <span>{categoryLabels[record.category]} · {statusLabels[effectiveStatus(record)]}</span>
              <h3>{record.title}</h3>
              <p className="archive-card-artist">{archiveArtist(record)}</p>
              <dl className="archive-card-facts"><dt>日期</dt><dd>{formatDateCn(record.date, record.time)}</dd><dt>场馆</dt><dd>{archiveLocation(record)}</dd><dt>票座</dt><dd className="archive-ticket-line"><b>{archivePrice(record)}</b><span>{record.seat || "座位待补"}</span></dd></dl>
              <strong>{formatRelativeDay(record.date)}</strong>
            </button>
            <div className="wallet-actions"><button type="button" title="打开" onClick={() => onOpen(record)}><Eye /></button><button type="button" title="编辑" onClick={() => onEdit(record)}><Pencil /></button></div>
          </article>
        );
      })}
    </section>
  );
}

function TicketView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return (
    <section className="archive-ticket-grid">
      {records.map((record) => (
        <button className="archive-ticket" data-archive-record-id={record.id} key={record.id} type="button" style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties} onClick={() => onOpen(record)}>
          <div className="archive-ticket-cover"><RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 2)} /></div>
          <section>
            <span className="archive-ticket-backdrop" aria-hidden="true"><RecordMedia media={primaryMedia(record)} alt="" fallback="" /></span>
            <span className="archive-ticket-tint" aria-hidden="true" />
            <div className="archive-ticket-content"><span>{categoryLabels[record.category]}</span><h3>{record.title}</h3><p className="archive-card-artist">{archiveArtist(record)}</p><dl className="archive-card-facts"><dt>DATE</dt><dd>{record.date}</dd><dt>VENUE</dt><dd>{archiveLocation(record)}</dd><dt>TICKET</dt><dd className="archive-ticket-line"><b>{archivePrice(record)}</b><span>{record.seat || "座位待补"}</span></dd></dl></div>
          </section>
        </button>
      ))}
    </section>
  );
}

function TimelineView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const ordered = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const groups = groupBy(ordered, (record) => record.date.slice(0, 4));
  return (
    <section className="archive-timeline">
      {Object.entries(groups).map(([year, items]) => (
        <div key={year}><h2>{year}</h2><div>{items.map((record) => <button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
          <time>{record.date.slice(5).replace("-", ".")}</time>
          <span><RecordMedia media={primaryMedia(record)} alt="" fallback="演" /></span>
          <section><em>{categoryLabels[record.category]}</em><h3>{record.title}</h3><strong className="archive-card-artist">{archiveArtist(record)}</strong><p>{archiveLocation(record)} · {archivePrice(record)}</p></section>
        </button>)}</div></div>
      ))}
    </section>
  );
}

function CalendarView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const groups = groupBy(records, (record) => record.date.slice(0, 7));
  return <section className="archive-calendar">{Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)).map(([month, items]) => <article key={month}>
    <h2>{month.replace("-", " / ")}</h2>
    <div>{items.sort((a, b) => a.date.localeCompare(b.date)).map((record) => <button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
      <strong>{record.date.slice(8)}</strong>
      <span><b>{record.title}</b><small className="archive-card-artist">{archiveArtist(record)}</small></span>
      <em>{record.city || "城市待补"} · {archivePrice(record)}</em>
    </button>)}</div>
  </article>)}</section>;
}

const cityCoordinateFallbacks: Record<string, [number, number]> = {
  北京: [116.4, 39.9], 上海: [121.47, 31.23], 广州: [113.27, 23.13], 深圳: [114.06, 22.54],
  成都: [104.07, 30.67], 重庆: [106.55, 29.56], 西安: [108.94, 34.34], 武汉: [114.31, 30.59],
  南京: [118.8, 32.06], 杭州: [120.16, 30.27], 苏州: [120.58, 31.3], 天津: [117.2, 39.12],
  郑州: [113.63, 34.75], 长沙: [112.94, 28.23], 青岛: [120.38, 36.07], 济南: [117.12, 36.65],
  昆明: [102.83, 25.04], 厦门: [118.09, 24.48], 福州: [119.3, 26.08], 南昌: [115.86, 28.68],
  合肥: [117.23, 31.82], 沈阳: [123.43, 41.8], 哈尔滨: [126.64, 45.76], 长春: [125.32, 43.82],
  乌鲁木齐: [87.62, 43.83], 拉萨: [91.13, 29.65], 兰州: [103.84, 36.06], 西宁: [101.78, 36.62],
  银川: [106.23, 38.49], 呼和浩特: [111.75, 40.84], 海口: [110.2, 20.04], 三亚: [109.51, 18.25],
};

type PlaceMode = "city" | "venue";

type PlaceGroup = {
  key: string;
  label: string;
  count: number;
  heat: number;
  point?: [number, number];
  records: EventRecord[];
};

function placeKey(record: EventRecord, mode: PlaceMode) {
  return mode === "city" ? record.city : [record.city, record.venue].filter(Boolean).join(" · ");
}

function buildPlaceGroups(records: EventRecord[], mode: PlaceMode): PlaceGroup[] {
  const grouped = new Map<string, EventRecord[]>();
  records.forEach((record) => {
    const key = placeKey(record, mode);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), record]);
  });
  const maxCount = Math.max(1, ...Array.from(grouped.values(), (items) => items.length));
  return Array.from(grouped.entries()).map(([key, items]) => {
    const ordered = [...items].sort((a, b) => b.date.localeCompare(a.date));
    const count = ordered.length;
    const explicit = ordered.find((record) => record.coordinates)?.coordinates;
    const point: [number, number] | undefined = explicit
      ? [explicit.lng, explicit.lat]
      : cityCoordinateFallbacks[ordered[0]?.city || ""];
    return { key, label: key, count, heat: count / maxCount, point, records: ordered };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
}

function placeHeatColor(heat: number) {
  const clamped = Math.max(0, Math.min(1, heat));
  const hue = Math.round(178 - clamped * 154);
  const saturation = Math.round(58 + clamped * 18);
  const lightness = Math.round(48 + clamped * 4);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function placeGroupMapFingerprint(groups: PlaceGroup[]) {
  return groups.map((group) => {
    const point = group.point ? `${group.point[0].toFixed(5)},${group.point[1].toFixed(5)}` : "none";
    const posters = group.records.slice(0, 3).map((record) => {
      const poster = primaryMedia(record);
      return `${record.id}:${poster?.storagePath || poster?.id || ""}`;
    }).join(",");
    return `${group.key}:${group.count}:${point}:${posters}`;
  }).join("|");
}

async function resolveMarkerPosterSources(groups: PlaceGroup[]) {
  const sources = new Map<string, string>();
  const records = new Map<string, EventRecord>();
  for (const group of groups) {
    for (const record of group.records.slice(0, 3)) records.set(record.id, record);
  }
  await Promise.all(Array.from(records.values()).map(async (record) => {
    const media = primaryMedia(record);
    const image = await loadMediaImage(media).catch(() => null);
    const source = image?.src || await resolveMediaSource(media).catch(() => "");
    if (source) sources.set(record.id, source);
  }));
  return sources;
}

function buildPosterMarkerContent(group: PlaceGroup, posterSources: Map<string, string>) {
  const markerContent = document.createElement("button");
  markerContent.type = "button";
  markerContent.className = "amap-poster-marker";
  markerContent.dataset.placeKey = group.key;
  markerContent.dataset.count = String(group.count);
  markerContent.style.setProperty("--heat", String(group.heat));
  markerContent.style.setProperty("--heat-color", placeHeatColor(group.heat));
  markerContent.setAttribute("aria-label", `${group.label} · ${group.count} 场`);
  markerContent.title = `${group.label} · ${group.count} 场`;

  const stack = document.createElement("span");
  stack.className = "amap-poster-stack";
  group.records.slice(0, 3).forEach((record, index) => {
    const frame = document.createElement("span");
    frame.className = "amap-poster-layer";
    frame.style.setProperty("--poster-index", String(index));
    const source = posterSources.get(record.id) || "";
    if (source) {
      const image = document.createElement("img");
      image.src = source;
      image.alt = "";
      image.decoding = "async";
      image.addEventListener("error", () => {
        image.remove();
        frame.classList.add("is-fallback");
        frame.textContent = record.title.slice(0, 1);
      }, { once: true });
      frame.appendChild(image);
    } else {
      frame.classList.add("is-fallback");
      frame.textContent = record.title.slice(0, 1);
    }
    stack.appendChild(frame);
  });
  markerContent.appendChild(stack);

  const badge = document.createElement("span");
  badge.className = "amap-poster-count";
  badge.textContent = String(group.count);
  markerContent.appendChild(badge);
  markerContent.addEventListener("click", (event) => event.stopPropagation());
  return markerContent;
}

function VenueView({ records, mapSettings, onOpenMapSettings, onOpen }: { records: EventRecord[]; mapSettings: AppSettings["map"]; onOpenMapSettings: () => void; onOpen: (record: EventRecord) => void }) {
  const [mode, setMode] = useState<PlaceMode>("city");
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string | null>(null);
  const [hoveredPlaceKey, setHoveredPlaceKey] = useState<string | null>(null);
  const [focusPlaceKey, setFocusPlaceKey] = useState<string | null>(null);
  const groups = useMemo(() => buildPlaceGroups(records, mode), [mode, records]);

  useEffect(() => {
    setSelectedPlaceKey(null);
    setHoveredPlaceKey(null);
    setFocusPlaceKey(null);
  }, [mode]);

  let mapPanel: ReactNode;
  if (mapSettings.provider === "amap" && !mapSettings.amapKey.trim()) {
    mapPanel = <div className="venue-map-state" data-map-mode="amap-missing-key"><MapIcon /><strong>配置高德 Key 后显示真实足迹底图</strong><p>你已经选择高德地图，但当前设备没有可用的 Web 端 JS API Key。</p><button type="button" onClick={onOpenMapSettings}>配置高德 Key</button></div>;
  } else if (mapSettings.provider === "amap") {
    mapPanel = <AmapFootprintMap
      groups={groups}
      mode={mode}
      mapSettings={mapSettings}
      selectedPlaceKey={selectedPlaceKey}
      hoveredPlaceKey={hoveredPlaceKey}
      focusPlaceKey={focusPlaceKey}
      onSelectPlace={setSelectedPlaceKey}
      onHoverPlace={setHoveredPlaceKey}
      onOpen={onOpen}
    />;
  } else if (mapSettings.provider === "baidu") {
    mapPanel = <div className="venue-map-state" data-map-mode="baidu-not-ready"><MapIcon /><strong>百度地图尚未接入当前足迹视图</strong><p>为避免“切换了但底图没变化”的假状态，这里不再回退到其他地图。</p><button type="button" onClick={onOpenMapSettings}>切换地图来源</button></div>;
  } else {
    mapPanel = <div className="venue-map-art venue-offline-summary" data-map-mode="offline-summary"><div className="venue-map-heading"><span>MEMORY PLACES</span><strong>离线城市摘要</strong><small>无需 API · 只显示已记录城市，不模拟行政边界</small></div><div className="venue-offline-grid">{groups.slice(0, 18).map((group) => <button key={group.key} type="button" style={{ "--weight": group.heat, "--heat-color": placeHeatColor(group.heat) } as CSSProperties} onClick={() => setSelectedPlaceKey(group.key)}><b>{group.label}</b><span>{group.count} 场</span></button>)}</div><button className="venue-enable-map" type="button" onClick={onOpenMapSettings}>启用高德地图</button></div>;
  }

  return (
    <section className="archive-venue-view">
      {mapPanel}
      <div className="venue-ranking">
        <header><span>足迹整理</span><h2>{mode === "city" ? "常去城市" : "常去场馆"}</h2><div><button className={mode === "city" ? "is-active" : ""} type="button" onClick={() => setMode("city")}>城市</button><button className={mode === "venue" ? "is-active" : ""} type="button" onClick={() => setMode("venue")}>场馆</button></div></header>
        <div className="venue-ranking-list">
          {groups.map((group) => <button
            key={group.key}
            type="button"
            className={`${selectedPlaceKey === group.key ? "is-selected " : ""}${hoveredPlaceKey === group.key ? "is-hovered" : ""}`.trim()}
            style={{ "--ratio": `${group.heat * 100}%`, "--heat": group.heat, "--heat-color": placeHeatColor(group.heat) } as CSSProperties}
            onMouseEnter={() => setHoveredPlaceKey(group.key)}
            onMouseLeave={() => setHoveredPlaceKey(null)}
            onClick={() => { setSelectedPlaceKey(group.key); setFocusPlaceKey(group.key); }}
          ><span>{group.label}</span><i /><b>{group.count}</b></button>)}
        </div>
        <div className="venue-heat-legend"><span>低频</span><i /><span>高频</span></div>
      </div>
    </section>
  );
}

function AmapFootprintMap({ groups, mode, mapSettings, selectedPlaceKey, hoveredPlaceKey, focusPlaceKey, onSelectPlace, onHoverPlace, onOpen }: {
  groups: PlaceGroup[];
  mode: PlaceMode;
  mapSettings: AppSettings["map"];
  selectedPlaceKey: string | null;
  hoveredPlaceKey: string | null;
  focusPlaceKey: string | null;
  onSelectPlace: (key: string | null) => void;
  onHoverPlace: (key: string | null) => void;
  onOpen: (record: EventRecord) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMapInstance | null>(null);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const markerElementsRef = useRef(new Map<string, HTMLElement>());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const selectedGroup = groups.find((group) => group.key === selectedPlaceKey) || null;
  const mapFingerprint = useMemo(() => placeGroupMapFingerprint(groups), [groups]);

  useEffect(() => {
    let disposed = false;
    setStatus("loading");
    markerElementsRef.current.clear();
    const mapGroups = groupsRef.current;
    loadAmap({ key: mapSettings.amapKey, securityCode: mapSettings.amapSecurityCode })
      .then(async (AMap) => {
        if (disposed || !hostRef.current) return;
        const map = new AMap.Map(hostRef.current, {
          center: [104.2, 35.8],
          zoom: 4.1,
          viewMode: "2D",
          resizeEnable: false,
        });
        mapRef.current = map;

        // Marker posters use the exact same media cache as every archive/share view.
        // Resolve them in parallel before mounting markers, so entering the map does
        // not trigger a second progressive image download sequence.
        const posterSources = await resolveMarkerPosterSources(mapGroups);
        if (disposed || !mapRef.current) return;
        const markers = mapGroups.flatMap((group) => {
          if (!group.point) return [];
          const markerContent = buildPosterMarkerContent(group, posterSources);
          markerElementsRef.current.set(group.key, markerContent);
          const marker = new AMap.Marker({
            position: group.point,
            title: `${group.label} · ${group.count} 场`,
            content: markerContent,
            anchor: "bottom-center",
            zIndex: 100 + Math.round(group.heat * 100),
          });
          marker.on?.("click", (event) => {
            const original = (event as { originalEvent?: { stopPropagation?: () => void } } | undefined)?.originalEvent;
            original?.stopPropagation?.();
            onSelectPlace(group.key);
          });
          marker.on?.("mouseover", () => onHoverPlace(group.key));
          marker.on?.("mouseout", () => onHoverPlace(null));
          return [marker];
        });
        map.add?.(markers);
        map.on?.("click", () => onSelectPlace(null));
        hostRef.current.dataset.amapReady = "true";
        setStatus("ready");
      })
      .catch(() => { if (!disposed) setStatus("error"); });
    return () => {
      disposed = true;
      markerElementsRef.current.clear();
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [mapFingerprint, mapSettings.amapKey, mapSettings.amapSecurityCode, onHoverPlace, onSelectPlace]);

  useEffect(() => {
    markerElementsRef.current.forEach((element, key) => {
      element.classList.toggle("is-selected", key === selectedPlaceKey);
      element.classList.toggle("is-hovered", key === hoveredPlaceKey);
    });
  }, [hoveredPlaceKey, selectedPlaceKey]);

  useEffect(() => {
    if (!focusPlaceKey || !mapRef.current) return;
    const group = groupsRef.current.find((item) => item.key === focusPlaceKey);
    if (group?.point) mapRef.current.setZoomAndCenter?.(6.8, group.point, false, 420);
  }, [focusPlaceKey]);

  return <div className="amap-map-shell" data-map-mode="amap">
    <div className="venue-map-heading"><span>AMAP · MEMORY MAP</span><strong>{mode === "city" ? "城市海报足迹" : "场馆海报足迹"}</strong><small>{status === "ready" ? "地图保持当前视野；点击地点时才会主动聚焦" : status === "error" ? "地图加载失败，请检查 Key、安全密钥或域名白名单" : "正在载入高德地图…"}</small></div>
    <div ref={hostRef} className="amap-map-host" data-amap-status={status} />
    <div className="map-heat-legend"><span>低频</span><i /><span>高频</span></div>
    {selectedGroup && <div className="venue-place-picker" data-place-key={selectedGroup.key}>
      <header><div><span>{mode === "city" ? "城市" : "场馆"}</span><strong>{selectedGroup.label}</strong><small>{selectedGroup.count} 场 · 选择海报打开详情</small></div><button type="button" aria-label="关闭地点演出选择" onClick={() => onSelectPlace(null)}>×</button></header>
      <div className={selectedGroup.count === 1 ? "is-single" : "is-multiple"}>
        {selectedGroup.records.map((record) => <button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
          <span><RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 1)} /></span>
          <section><strong>{record.title}</strong><small>{record.date} · {record.venue || record.city}</small></section>
        </button>)}
      </div>
    </div>}
    {status === "error" ? <button className="venue-enable-map" type="button" onClick={() => window.location.reload()}>重新载入</button> : null}
  </div>;
}

function PriceView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const priced = [...records].sort((a, b) => (b.price || 0) - (a.price || 0));
  const max = Math.max(1, ...priced.map((record) => record.price || 0));
  const filled = priced.filter((record) => record.price);
  const average = Math.round(filled.reduce((sum, record) => sum + (record.price || 0), 0) / Math.max(1, filled.length));
  return <section className="archive-price">
    <div className="price-metrics"><strong>{records.length}<span>记录</span></strong><strong>¥{average}<span>均价</span></strong><strong>¥{filled.reduce((sum, record) => sum + (record.price || 0), 0)}<span>总票价</span></strong></div>
    <div>{priced.map((record, index) => <button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
      <span>{String(index + 1).padStart(2, "0")}</span>
      <section><h3>{record.title}</h3><strong className="archive-card-artist">{archiveArtist(record)}</strong><p>{record.date} · {record.city || "城市待补"} · {record.seat || "座位待补"}</p></section>
      <i style={{ "--ratio": `${Math.max(4, ((record.price || 0) / max) * 100)}%` } as CSSProperties} />
      <strong>{archivePrice(record)}</strong>
    </button>)}</div>
  </section>;
}

function SummaryView({ records }: { records: EventRecord[] }) {
  return <section className="archive-summary"><SummaryPanel title="常看艺人" rows={topRows(records.flatMap((record) => record.artists))} /><SummaryPanel title="城市足迹" rows={topRows(records.map((record) => record.city).filter(Boolean))} /><SummaryPanel title="标签热度" rows={topRows(records.flatMap((record) => record.tags))} /><SummaryPanel title="演出类型" rows={topRows(records.map((record) => categoryLabels[record.category]))} /></section>;
}

function SummaryPanel({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return <article><h2>{title}</h2>{rows.map(([label, count]) => <p key={label}><span>{label}</span><i><b style={{ width: `${count / max * 100}%` }} /></i><strong>{count}</strong></p>)}</article>;
}

function ListView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return <section className="archive-list">
    <header><span>日期</span><span>演出</span><span>艺人</span><span>地点</span><span>票座</span></header>
    {records.map((record) => <button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
      <span>{record.date}</span>
      <strong>{record.title}</strong>
      <em className="archive-card-artist">{archiveArtist(record)}</em>
      <span>{archiveLocation(record)}</span>
      <div className="archive-list-ticket"><span>{archivePrice(record)}</span><small>{record.seat || "座位待补"}</small></div>
    </button>)}
  </section>;
}

function RecordMedia({ media, alt, fallback = "图片待补", onClick }: { media?: MediaAsset; alt?: string; fallback?: string; onClick?: (event: MouseEvent<HTMLImageElement | HTMLSpanElement>) => void }) {
  const src = useCachedMediaSrc(media);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src, media?.storagePath]);
  if (!src || failed) return <span className="record-media-fallback" onClick={onClick}>{media?.storagePath ? "图片正在载入" : fallback}</span>;
  return <img
    src={src}
    alt={alt || ""}
    loading="lazy"
    decoding="async"
    onClick={onClick}
    onError={() => {
      setFailed(true);
      if (media?.storagePath) {
        window.dispatchEvent(new CustomEvent("live-memory:cloud-media-refresh", { detail: { storagePath: media.storagePath } }));
      }
    }}
  />;
}

function ArchiveEmpty() {
  return <section className="archive-empty"><Ticket /><h2>没有找到符合条件的演出</h2><p>换一个筛选条件，或者新增一条演出记录。</p></section>;
}

function FilterChips<T extends string>({ label, values, options, labels, onChange }: { label: string; values: T[]; options: T[]; labels: Record<T, string>; onChange: (values: T[]) => void }) {
  return <div className="archive-filter-row"><span>{label}</span><button className={!values.length ? "is-active" : ""} type="button" onClick={() => onChange([])}>全部</button>{options.map((option) => <button className={values.includes(option) ? "is-active" : ""} key={option} type="button" onClick={() => onChange(toggleValue(values, option))}>{labels[option]}</button>)}</div>;
}

function StringFilterChips({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (values: string[]) => void }) {
  if (!options.length) return null;
  return <div className="archive-filter-row"><span>{label}</span><button className={!values.length ? "is-active" : ""} type="button" onClick={() => onChange([])}>全部</button>{options.slice(0, 12).map((option) => <button className={values.includes(option) ? "is-active" : ""} key={option} type="button" onClick={() => onChange(toggleValue(values, option))}>{option}</button>)}</div>;
}

function filterRecords(records: EventRecord[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (query && ![record.title, record.city, record.venue, record.artists.join(" "), record.tags.join(" "), record.note].join(" ").toLowerCase().includes(query)) return false;
    if (filters.categories.length && !filters.categories.includes(record.category)) return false;
    if (filters.statuses.length && !filters.statuses.includes(effectiveStatus(record))) return false;
    if (filters.years.length && !filters.years.includes(record.date.slice(0, 4))) return false;
    if (filters.cities.length && !filters.cities.includes(record.city)) return false;
    if (filters.artists.length && !record.artists.some((artist) => filters.artists.includes(artist))) return false;
    if (filters.tags.length && !record.tags.some((tag) => filters.tags.includes(tag))) return false;
    return true;
  });
}

function sortRecords(records: EventRecord[], sort: "smart" | "date-desc" | "date-asc" | "price-desc" | "updated-desc") {
  const next = [...records];
  if (sort === "date-asc") return next.sort((a, b) => a.date.localeCompare(b.date));
  if (sort === "price-desc") return next.sort((a, b) => (b.price || 0) - (a.price || 0));
  if (sort === "updated-desc") return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === "smart") return next.sort((a, b) => { const futureDifference = Number(daysFromToday(b.date) >= 0) - Number(daysFromToday(a.date) >= 0); return futureDifference || b.date.localeCompare(a.date); });
  return next.sort((a, b) => b.date.localeCompare(a.date));
}

function buildFacets(records: EventRecord[]) {
  return {
    categories: unique(records.map((record) => record.category)) as EventCategory[],
    statuses: unique(records.map((record) => effectiveStatus(record))) as EventStatus[],
    years: unique(records.map((record) => record.date.slice(0, 4))).sort((a, b) => b.localeCompare(a)),
    cities: unique(records.map((record) => record.city).filter(Boolean)),
    artists: unique(records.flatMap((record) => record.artists)).slice(0, 30),
  };
}

function unique<T extends string>(values: T[]) { return Array.from(new Set(values.filter(Boolean))); }
function toggleValue<T>(values: T[], value: T) { return values.includes(value) ? values.filter((item) => item !== value) : values.concat(value); }
function topRows(values: string[], limit = 10): [string, number][] { const counts = new Map<string, number>(); values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)); return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit); }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((groups, item) => { const value = key(item); groups[value] = groups[value] || []; groups[value].push(item); return groups; }, {}); }
