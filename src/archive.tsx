import {
  Archive,
  CalendarDays,
  ChevronDown,
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
  X,
} from "lucide-react";
import {
  CSSProperties,
  Dispatch,
  MouseEvent,
  ReactNode,
  SetStateAction,
  useMemo,
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
export type { ShareFormat } from "./shareStudio";
import {
  categoryLabels,
  daysFromToday,
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
  onZoom: (media: MediaAsset) => void;
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
  onZoom,
}: ArchivePageProps) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<"smart" | "date-desc" | "date-asc" | "price-desc" | "updated-desc">("smart");
  const [expanded, setExpanded] = useState(false);
  const preferredPosterColumns = Math.min(8, Math.max(4, settings.posterColumns || 5));
  const [density, setDensity] = useState(preferredPosterColumns);
  const facets = useMemo(() => buildFacets(records), [records]);
  const visibleRecords = useMemo(() => sortRecords(filterRecords(records, filters), sort), [filters, records, sort]);
  const activeFilterCount = filters.categories.length + filters.statuses.length + filters.years.length + filters.cities.length + filters.artists.length + filters.tags.length;

  if (shareMode) {
    return (
      <ShareStudio
        records={visibleRecords}
        format={shareFormat}
        setFormat={setShareFormat}
        onClose={() => setShareMode(false)}
      />
    );
  }

  return (
    <section className="archive-page">
      <header className="archive-masthead">
        <div className="archive-masthead-copy">
          <span>我的演出记录</span>
          <h2>现场，一场一场地留下来。</h2>
          <p>海报、票根、日期和城市都放在同一个档案里，需要时再切换查看方式。</p>
          <div className="archive-masthead-stats" aria-label="演出记录摘要">
            <strong>{records.length}<span>全部记录</span></strong>
            <strong>{records.filter((record) => record.status === "watched").length}<span>已经看过</span></strong>
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

      <div className="archive-result-strip">
        <strong>{visibleRecords.length}</strong>
        <span>条档案</span>
        <em>{layoutGroups.flatMap((group) => group.items).find((item) => item.value === layout)?.label}</em>
      </div>

      <ArchiveRenderer
        records={visibleRecords}
        layout={layout}
        density={density}
        onOpen={onOpen}
        onEdit={onEdit}
        onZoom={onZoom}
      />
    </section>
  );
}

function ArchiveHighlights({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const highlights = records.filter((record) => primaryMedia(record)).slice(0, 5);
  if (!highlights.length) return <div className="archive-highlight-empty"><span>海报</span><span>票根</span><span>现场</span></div>;
  return (
    <div className="archive-highlights">
      {highlights.map((record, index) => (
        <button key={record.id} type="button" style={{ "--highlight-index": index } as CSSProperties} onClick={() => onOpen(record)}>
          <RecordMedia media={primaryMedia(record)} alt={record.title} />
          <span>{record.city || categoryLabels[record.category]}</span>
        </button>
      ))}
    </div>
  );
}

function ArchiveRenderer({
  records,
  layout,
  density,
  onOpen,
  onEdit,
  onZoom,
}: {
  records: EventRecord[];
  layout: ArchiveLayout;
  density: number;
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
  if (layout === "venue") return <VenueView records={records} onOpen={onOpen} />;
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

function PosterCard({ record, index, onOpen, onZoom }: { record: EventRecord; index: number; onOpen: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  const poster = primaryMedia(record);
  return (
    <article className="archive-poster-card" onClick={() => onOpen(record)}>
      <span className="archive-rank">#{String(index + 1).padStart(2, "0")}</span>
      <button className="archive-poster-media" type="button" onClick={(event) => { event.stopPropagation(); if (poster) onZoom(poster); else onOpen(record); }}>
        <RecordMedia media={poster} alt={record.title} fallback={record.title.slice(0, 4)} />
      </button>
      <div className="archive-poster-copy">
        <div><span>{categoryLabels[record.category]}</span><em>{statusLabels[record.status]}</em></div>
        <h3>{record.title}</h3>
        <p>{record.artists.join(" / ") || "艺人待补"}</p>
        <dl>
          <dt>日期</dt><dd>{formatDateCn(record.date, record.time)}</dd>
          <dt>场馆</dt><dd>{record.city || "城市待补"} · {record.venue || "场馆待补"}</dd>
          <dt>票价</dt><dd>{record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"}</dd>
        </dl>
      </div>
    </article>
  );
}

function ShowcaseView({ records, density, onOpen, onZoom }: { records: EventRecord[]; density: number; onOpen: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  return (
    <section className={`archive-showcase archive-showcase-density-${Math.min(5, Math.max(2, density))}`}>
      {records.map((record, index) => {
        const poster = primaryMedia(record);
        return (
          <article className={`showcase-card showcase-card-${index % 7}`} key={record.id} onClick={() => onOpen(record)}>
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
    </section>
  );
}

function WalletView({ records, onOpen, onEdit, onZoom }: { records: EventRecord[]; onOpen: (record: EventRecord) => void; onEdit: (record: EventRecord) => void; onZoom: (media: MediaAsset) => void }) {
  return (
    <section className="archive-wallet-grid">
      {records.map((record) => {
        const poster = primaryMedia(record);
        return (
          <article className="archive-wallet-card" key={record.id} style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties}>
            <button className="wallet-cover" type="button" onClick={() => poster ? onZoom(poster) : onOpen(record)}><RecordMedia media={poster} alt={record.title} fallback={record.title.slice(0, 2)} /></button>
            <button className="wallet-copy" type="button" onClick={() => onOpen(record)}>
              <span>{categoryLabels[record.category]} · {statusLabels[record.status]}</span>
              <h3>{record.title}</h3>
              <p>{record.artists.join(" / ") || "艺人待补"}</p>
              <dl><dt>日期</dt><dd>{formatDateCn(record.date, record.time)}</dd><dt>场馆</dt><dd>{record.city} · {record.venue}</dd><dt>票座</dt><dd>{record.price ? `¥${record.price}` : "票价待补"} · {record.seat || "座位待补"}</dd></dl>
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
        <button className="archive-ticket" key={record.id} type="button" onClick={() => onOpen(record)}>
          <div><RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 2)} /></div>
          <section><span>{categoryLabels[record.category]}</span><h3>{record.title}</h3><p>{record.artists.join(" / ") || "艺人待补"}</p><dl><dt>DATE</dt><dd>{record.date}</dd><dt>VENUE</dt><dd>{record.city} · {record.venue}</dd><dt>SEAT</dt><dd>{record.seat || "座位待补"}</dd></dl></section>
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
        <div key={year}><h2>{year}</h2><div>{items.map((record) => <button key={record.id} type="button" onClick={() => onOpen(record)}><time>{record.date.slice(5).replace("-", ".")}</time><span><RecordMedia media={primaryMedia(record)} alt="" fallback="演" /></span><section><em>{categoryLabels[record.category]}</em><h3>{record.title}</h3><p>{record.artists.join(" / ")} · {record.city} · {record.venue}</p></section></button>)}</div></div>
      ))}
    </section>
  );
}

function CalendarView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const groups = groupBy(records, (record) => record.date.slice(0, 7));
  return <section className="archive-calendar">{Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)).map(([month, items]) => <article key={month}><h2>{month.replace("-", " / ")}</h2><div>{items.sort((a, b) => a.date.localeCompare(b.date)).map((record) => <button key={record.id} type="button" onClick={() => onOpen(record)}><strong>{record.date.slice(8)}</strong><span>{record.title}</span><em>{record.city}</em></button>)}</div></article>)}</section>;
}

function VenueView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const [mode, setMode] = useState<"city" | "venue">("city");
  const rows = mode === "city" ? topRows(records.map((record) => record.city).filter(Boolean), 30) : topRows(records.map((record) => [record.city, record.venue].filter(Boolean).join(" · ")).filter(Boolean), 30);
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return (
    <section className="archive-venue-view">
      <div className="venue-map-art"><span>MEMORY MAP</span>{rows.slice(0, 12).map(([name, count], index) => <button key={name} type="button" style={{ "--x": `${12 + (index * 23) % 78}%`, "--y": `${15 + (index * 31) % 68}%`, "--weight": count } as CSSProperties} onClick={() => { const record = records.find((item) => mode === "city" ? item.city === name : [item.city, item.venue].filter(Boolean).join(" · ") === name); if (record) onOpen(record); }}><i /><b>{name}</b><em>{count}</em></button>)}</div>
      <div className="venue-ranking"><header><span>足迹整理</span><h2>{mode === "city" ? "常去城市" : "常去场馆"}</h2><div><button className={mode === "city" ? "is-active" : ""} type="button" onClick={() => setMode("city")}>城市</button><button className={mode === "venue" ? "is-active" : ""} type="button" onClick={() => setMode("venue")}>场馆</button></div></header>{rows.map(([name, count]) => <p key={name} style={{ "--ratio": `${count / max * 100}%` } as CSSProperties}><span>{name}</span><i /><b>{count}</b></p>)}</div>
    </section>
  );
}

function PriceView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const priced = [...records].sort((a, b) => (b.price || 0) - (a.price || 0));
  const max = Math.max(1, ...priced.map((record) => record.price || 0));
  const filled = priced.filter((record) => record.price);
  const average = Math.round(filled.reduce((sum, record) => sum + (record.price || 0), 0) / Math.max(1, filled.length));
  return <section className="archive-price"><div className="price-metrics"><strong>{records.length}<span>记录</span></strong><strong>¥{average}<span>均价</span></strong><strong>¥{filled.reduce((sum, record) => sum + (record.price || 0), 0)}<span>总票价</span></strong></div><div>{priced.map((record, index) => <button key={record.id} type="button" onClick={() => onOpen(record)}><span>{String(index + 1).padStart(2, "0")}</span><section><h3>{record.title}</h3><p>{record.artists.join(" / ")} · {record.date} · {record.city}</p></section><i style={{ "--ratio": `${Math.max(4, ((record.price || 0) / max) * 100)}%` } as CSSProperties} /><strong>{record.price ? `¥${record.price}` : "待补"}</strong></button>)}</div></section>;
}

function SummaryView({ records }: { records: EventRecord[] }) {
  return <section className="archive-summary"><SummaryPanel title="常看艺人" rows={topRows(records.flatMap((record) => record.artists))} /><SummaryPanel title="城市足迹" rows={topRows(records.map((record) => record.city).filter(Boolean))} /><SummaryPanel title="标签热度" rows={topRows(records.flatMap((record) => record.tags))} /><SummaryPanel title="演出类型" rows={topRows(records.map((record) => categoryLabels[record.category]))} /></section>;
}

function SummaryPanel({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return <article><h2>{title}</h2>{rows.map(([label, count]) => <p key={label}><span>{label}</span><i><b style={{ width: `${count / max * 100}%` }} /></i><strong>{count}</strong></p>)}</article>;
}

function ListView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return <section className="archive-list"><header><span>日期</span><span>演出</span><span>艺人</span><span>地点</span><span>票价</span></header>{records.map((record) => <button key={record.id} type="button" onClick={() => onOpen(record)}><span>{record.date}</span><strong>{record.title}</strong><em>{record.artists.join(" / ") || "待补"}</em><span>{record.city} · {record.venue}</span><b>{record.price ? `¥${record.price}` : "待补"}</b></button>)}</section>;
}

function RecordMedia({ media, alt, fallback = "图片待补", onClick }: { media?: MediaAsset; alt?: string; fallback?: string; onClick?: (event: MouseEvent<HTMLImageElement | HTMLSpanElement>) => void }) {
  const [failed, setFailed] = useState(false);
  if (!media?.src || failed) return <span className="record-media-fallback" onClick={onClick}>{media?.storagePath ? "图片正在重新加载" : fallback}</span>;
  return <img src={media.src} alt={alt || ""} loading="lazy" onClick={onClick} onError={() => { setFailed(true); if (media.storagePath) window.dispatchEvent(new Event("live-memory:cloud-media-refresh")); }} />;
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
    if (filters.statuses.length && !filters.statuses.includes(record.status)) return false;
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
    statuses: unique(records.map((record) => record.status)) as EventStatus[],
    years: unique(records.map((record) => record.date.slice(0, 4))).sort((a, b) => b.localeCompare(a)),
    cities: unique(records.map((record) => record.city).filter(Boolean)),
    artists: unique(records.flatMap((record) => record.artists)).slice(0, 30),
  };
}

function unique<T extends string>(values: T[]) { return Array.from(new Set(values.filter(Boolean))); }
function toggleValue<T>(values: T[], value: T) { return values.includes(value) ? values.filter((item) => item !== value) : values.concat(value); }
function topRows(values: string[], limit = 10): [string, number][] { const counts = new Map<string, number>(); values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)); return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit); }
function groupBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, T[]>>((groups, item) => { const value = key(item); groups[value] = groups[value] || []; groups[value].push(item); return groups; }, {}); }
