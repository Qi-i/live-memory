import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Github,
  Heart,
  ImagePlus,
  Import,
  List,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CSSProperties, Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  AppSettings,
  ArchiveView,
  EventCategory,
  EventRecord,
  EventStatus,
  Filters,
  ImportDraft,
  MediaAsset,
  categoryLabels,
  createId,
  daysFromToday,
  defaultSettings,
  formatDateCn,
  formatRelativeDay,
  mediaByKind,
  mediaKindLabels,
  primaryMedia,
  sourceLabels,
  splitTextList,
  storageModeLabels,
  statusLabels,
  viewLabels,
} from "./domain";
import { createDraftsFromText } from "./importers";
import { downloadBlob, fileToMedia, makeMedia, nowIso } from "./media";
import { blankRecord } from "./seeds";
import {
  deleteRecord,
  loadRecordsWithMigration,
  readSettings,
  replaceAllRecords,
  saveRecord,
  storageHealth,
  writeSettings,
} from "./storage";
import {
  currentUser,
  hasSupabaseConfig,
  pullRecordsFromSupabase,
  pushRecordsToSupabase,
  signInWithGithub,
  signInWithPassword,
  signOut,
} from "./supabase";

const emptyFilters: Filters = {
  query: "",
  categories: [],
  statuses: [],
  years: [],
  cities: [],
  artists: [],
  tags: [],
};

type Route = "archive" | "stats" | "backup" | "settings";
type SortMode = "smart" | "date-desc" | "date-asc" | "price-desc" | "updated-desc";

export default function App() {
  const [records, setRecords] = useState<EventRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [route, setRoute] = useState<Route>("archive");
  const [view, setView] = useState<ArchiveView>("poster");
  const [sort, setSort] = useState<SortMode>("smart");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [zoomMedia, setZoomMedia] = useState<MediaAsset | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadRecordsWithMigration(), Promise.resolve(readSettings())]).then(([loadedRecords, loadedSettings]) => {
      if (!mounted) return;
      setRecords(loadedRecords);
      setSettings(loadedSettings);
      setView(loadedSettings.defaultView);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const facets = useMemo(() => buildFacets(records), [records]);
  const filteredRecords = useMemo(() => sortRecords(filterRecords(records, filters), sort), [records, filters, sort]);
  const health = useMemo(() => storageHealth(records, settings), [records, settings]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function persistRecord(record: EventRecord) {
    const saved = await saveRecord(record);
    setRecords((current) => sortRecords(current.filter((item) => item.id !== saved.id).concat(saved), "date-desc"));
    setEditing(null);
    setSelected(saved);
    flash("已保存");
  }

  async function removeRecord(record: EventRecord) {
    await deleteRecord(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
    setSelected(null);
    flash("已删除");
  }

  async function updateSettings(next: AppSettings) {
    const saved = writeSettings(next);
    setSettings(saved);
    setView(saved.defaultView);
    flash("设置已保存");
  }

  function updatePosterColumns(posterColumns: number) {
    const saved = writeSettings({ ...settings, posterColumns });
    setSettings(saved);
  }

  async function replaceRecords(next: EventRecord[], message: string) {
    await replaceAllRecords(next);
    setRecords(sortRecords(next, "date-desc"));
    flash(message);
  }

  const title = route === "archive" ? "档案" : route === "stats" ? "统计" : route === "backup" ? "备份" : "设置";

  return (
    <div className="app">
      <aside className="rail">
        <button className="brand" type="button" onClick={() => setRoute("archive")}>
          <span className="brand-mark">演</span>
          <span>
            <strong>回响册</strong>
            <small>Live memory</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <RouteButton active={route === "archive"} icon={<Archive />} label="档案" onClick={() => setRoute("archive")} />
          <RouteButton active={route === "stats"} icon={<Sparkles />} label="统计" onClick={() => setRoute("stats")} />
          <RouteButton active={route === "backup"} icon={<ShieldCheck />} label="备份" onClick={() => setRoute("backup")} />
          <RouteButton active={route === "settings"} icon={<Settings />} label="设置" onClick={() => setRoute("settings")} />
        </nav>
      </aside>

      <main className="workspace">
        <header className="hero">
          <div className="hero-copy">
            <p>{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</p>
            <h1>{title}</h1>
            <span className="hero-subtitle">把票根、海报、座位图和现场高光照片收进一本会呼吸的演出相册。</span>
            <div className="hero-metrics">
              <strong>{records.length}<span>场记录</span></strong>
              <strong>{records.filter((record) => record.status === "watched").length}<span>已看</span></strong>
              <strong>{new Set(records.map((record) => record.city).filter(Boolean)).size}<span>城市</span></strong>
            </div>
          </div>
          <HeroPosterWall records={records} onOpen={setSelected} />
          <div className="hero-actions">
            <span className="sync-pill">
              <Cloud size={16} />
              {storageLocationLabel(settings)}
            </span>
            <label className="search">
              <Search size={18} />
              <input
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="搜索艺人 / 城市 / 场馆 / 主题"
              />
            </label>
            <button className="button ghost" type="button" onClick={() => setImportOpen(true)}>
              <Import size={18} />
              导入
            </button>
            <button className="button primary" type="button" onClick={() => setEditing(blankRecord())}>
              <Plus size={18} />
              新增
            </button>
          </div>
        </header>

        {route === "archive" && (
          <>
            <FilterBar
              filters={filters}
              setFilters={setFilters}
              facets={facets}
              view={view}
              setView={setView}
              sort={sort}
              setSort={setSort}
              posterColumns={settings.posterColumns}
              setPosterColumns={updatePosterColumns}
            />
            <CountBar count={filteredRecords.length} sort={sort} />
            <ArchiveViewRenderer records={filteredRecords} view={view} posterColumns={settings.posterColumns} settings={settings} onOpen={setSelected} onZoom={setZoomMedia} onEdit={setEditing} />
          </>
        )}
        {route === "stats" && <StatsView records={filteredRecords} allRecords={records} />}
        {route === "backup" && <BackupView records={records} onReplace={replaceRecords} />}
        {route === "settings" && (
          <SettingsView
            settings={settings}
            onSave={updateSettings}
            records={records}
            health={health}
            setRecords={setRecords}
            flash={flash}
            busy={busy}
            setBusy={setBusy}
          />
        )}
      </main>

      {selected && (
        <DetailDrawer
          record={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => removeRecord(selected)}
          onZoom={setZoomMedia}
          onSave={persistRecord}
        />
      )}
      {editing && <RecordEditor record={editing} onCancel={() => setEditing(null)} onSave={persistRecord} />}
      {importOpen && <ImportDrawer onClose={() => setImportOpen(false)} onSave={persistRecord} flash={flash} />}
      {zoomMedia && <ImageZoom media={zoomMedia} onClose={() => setZoomMedia(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function RouteButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`route ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function HeroPosterWall({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const picks = records.filter((record) => primaryMedia(record)).slice(0, 7);
  if (!picks.length) {
    return (
      <div className="hero-poster-wall is-empty" aria-hidden="true">
        <span>LIVE</span>
        <span>MEMORY</span>
        <span>TICKET</span>
      </div>
    );
  }
  return (
    <div className="hero-poster-wall" aria-label="演出海报精选">
      {picks.map((record, index) => {
        const media = primaryMedia(record);
        return (
          <button className={`hero-poster hero-poster-${index + 1}`} key={record.id} type="button" onClick={() => onOpen(record)}>
            {media && <img src={media.src} alt={record.title} />}
            <span>{record.city || categoryLabels[record.category]}</span>
          </button>
        );
      })}
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  facets,
  view,
  setView,
  sort,
  setSort,
  posterColumns,
  setPosterColumns,
}: {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  facets: ReturnType<typeof buildFacets>;
  view: ArchiveView;
  setView: (value: ArchiveView) => void;
  sort: SortMode;
  setSort: (value: SortMode) => void;
  posterColumns: number;
  setPosterColumns: (value: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = filters.categories.length + filters.statuses.length + filters.years.length + filters.cities.length + filters.artists.length + filters.tags.length;
  const clearFilters = () => setFilters((current) => ({ ...emptyFilters, query: current.query }));
  return (
    <section className="toolbar">
      <div className="toolbar-compact">
        <div>
          <span className="toolbar-kicker">筛选</span>
          <strong>{activeCount ? `${activeCount} 组条件生效` : "未展开高级筛选"}</strong>
        </div>
        <div className="toolbar-compact-actions">
          {activeCount > 0 && <button className="button ghost compact-button" type="button" onClick={clearFilters}>清空</button>}
          <button className="button primary compact-button" type="button" onClick={() => setExpanded((value) => !value)}>
            <Filter size={16} />
            {expanded ? "收起" : "筛选"}
          </button>
        </div>
      </div>
      <div className={`filter-clusters ${expanded ? "is-open" : ""}`}>
        <MultiSelect label="类型" values={filters.categories} options={facets.categories} labels={categoryLabels} onChange={(categories) => setFilters((current) => ({ ...current, categories }))} />
        <MultiSelect label="状态" values={filters.statuses} options={facets.statuses} labels={statusLabels} onChange={(statuses) => setFilters((current) => ({ ...current, statuses }))} />
        <ChipGroup label="年份" values={filters.years} options={facets.years} onChange={(years) => setFilters((current) => ({ ...current, years }))} />
        <ChipGroup label="城市" values={filters.cities} options={facets.cities} onChange={(cities) => setFilters((current) => ({ ...current, cities }))} />
        <ChipGroup label="艺人" values={filters.artists} options={facets.artists} onChange={(artists) => setFilters((current) => ({ ...current, artists }))} />
      </div>
      <div className={`toolbar-row ${view === "poster" ? "has-columns" : ""}`}>
        <label className="select-wrap">
          <span>排序</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="smart">智能排序</option>
            <option value="date-desc">时间最新</option>
            <option value="date-asc">时间最早</option>
            <option value="price-desc">票价最高</option>
            <option value="updated-desc">最近编辑</option>
          </select>
        </label>
        {view === "poster" && (
          <label className="select-wrap compact-select">
            <span>每行</span>
            <select value={posterColumns} onChange={(event) => setPosterColumns(Number(event.target.value))}>
              {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 张</option>)}
            </select>
          </label>
        )}
        <div className="view-switch" aria-label="展示方式">
          {(Object.keys(viewLabels) as ArchiveView[]).map((item) => (
            <button className={view === item ? "is-active" : ""} key={item} type="button" onClick={() => setView(item)}>
              {viewIcon(item)}
              <span>{viewLabels[item]}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function MultiSelect<T extends string>({
  label,
  values,
  options,
  labels,
  onChange,
}: {
  label: string;
  values: T[];
  options: T[];
  labels: Record<T, string>;
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="chip-set">
      <span>{label}</span>
      <button className={!values.length ? "is-active" : ""} type="button" onClick={() => onChange([])}>
        全部
      </button>
      {options.map((option) => (
        <button
          className={values.includes(option) ? "is-active" : ""}
          key={option}
          type="button"
          onClick={() => onChange(toggleValue(values, option))}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function ChipGroup({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (values: string[]) => void }) {
  if (!options.length) return null;
  return (
    <div className="chip-set">
      <span>{label}</span>
      <button className={!values.length ? "is-active" : ""} type="button" onClick={() => onChange([])}>
        全部
      </button>
      {options.slice(0, 8).map((option) => (
        <button
          className={values.includes(option) ? "is-active" : ""}
          key={option}
          type="button"
          onClick={() => onChange(toggleValue(values, option))}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function CountBar({ count, sort }: { count: number; sort: SortMode }) {
  return (
    <section className="count-bar">
      <span>演出</span>
      <strong>{count}</strong>
      <em>排序：{sort === "smart" ? "智能排序" : sort === "date-desc" ? "时间最新" : sort === "date-asc" ? "时间最早" : sort === "price-desc" ? "票价最高" : "最近编辑"}</em>
    </section>
  );
}

function ArchiveViewRenderer({
  records,
  view,
  posterColumns,
  settings,
  onOpen,
  onZoom,
  onEdit,
}: {
  records: EventRecord[];
  view: ArchiveView;
  posterColumns: number;
  settings: AppSettings;
  onOpen: (record: EventRecord) => void;
  onZoom: (asset: MediaAsset) => void;
  onEdit: (record: EventRecord) => void;
}) {
  if (!records.length) return <EmptyState />;
  if (view === "price") return <PriceView records={records} onOpen={onOpen} />;
  if (view === "timeline") return <TimelineView records={records} onOpen={onOpen} />;
  if (view === "summary") return <SummaryView records={records} />;
  if (view === "calendar") return <CalendarView records={records} onOpen={onOpen} />;
  if (view === "venue") return <VenueView records={records} settings={settings} />;
  if (view === "list") return <ListView records={records} onOpen={onOpen} />;
  if (view === "ticket") return <TicketView records={records} onOpen={onOpen} />;
  const gridStyle = {
    "--poster-columns": posterColumns,
    "--poster-mobile-columns": Math.min(3, posterColumns),
  } as CSSProperties;
  return (
    <section className={view === "poster" ? "poster-grid" : "wallet-list"} style={view === "poster" ? gridStyle : undefined}>
      {records.map((record, index) =>
        view === "wallet" ? (
          <WalletCard record={record} key={record.id} onOpen={onOpen} onZoom={onZoom} onEdit={onEdit} />
        ) : (
          <PosterCard compact={view === "poster"} index={index} record={record} key={record.id} onOpen={onOpen} onZoom={onZoom} />
        ),
      )}
    </section>
  );
}

function PosterCard({ record, index, compact, onOpen, onZoom }: { record: EventRecord; index: number; compact: boolean; onOpen: (record: EventRecord) => void; onZoom: (asset: MediaAsset) => void }) {
  const poster = primaryMedia(record);
  return (
    <article className={`poster-card ${compact ? "is-compact" : ""}`} onClick={() => onOpen(record)}>
      <button className="rank" type="button" aria-label={`第 ${index + 1} 条`}>
        #{String(index + 1).padStart(2, "0")}
      </button>
      <div className="poster-frame" style={{ background: `linear-gradient(135deg, ${record.colors[0]}, ${record.colors[1]})` }}>
        {poster ? <img src={poster.src} alt={record.title} onClick={(event) => { event.stopPropagation(); onZoom(poster); }} /> : <span>{record.title.slice(0, 4)}</span>}
      </div>
      <div className="poster-info">
        <div className="meta-row">
          <span className="badge">{categoryLabels[record.category]}</span>
          <span>{statusLabels[record.status]}</span>
        </div>
        <h3>{record.title}</h3>
        {!compact && <p>{record.artists.join(" / ") || "艺人待补"}</p>}
        <dl>
          <dt>日期</dt>
          <dd>{formatDateCn(record.date, record.time)}</dd>
          <dt>场馆</dt>
          <dd>{record.city} · {record.venue || "场馆待补"}</dd>
          <dt>票价</dt>
          <dd>{record.price ? `¥${record.price}` : record.publicPriceRange || "未填票价"}</dd>
        </dl>
      </div>
    </article>
  );
}

function WalletCard({ record, onOpen, onZoom, onEdit }: { record: EventRecord; onOpen: (record: EventRecord) => void; onZoom: (asset: MediaAsset) => void; onEdit: (record: EventRecord) => void }) {
  const poster = primaryMedia(record);
  return (
    <article className="wallet-card" style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties}>
      <button className="cover-button" type="button" onClick={() => (poster ? onZoom(poster) : onOpen(record))}>
        {poster ? <img src={poster.src} alt={record.title} /> : <span>{record.title.slice(0, 3)}</span>}
      </button>
      <button className="wallet-main" type="button" onClick={() => onOpen(record)}>
        <span className={`status-pill ${statusClass(record.status)}`}>{statusLabels[record.status]}</span>
        <span className="wallet-kind">{categoryLabels[record.category]}</span>
        <h3>{record.title}</h3>
        <p>{record.artists.join(" / ") || "艺人待补"}</p>
        <dl className="wallet-facts">
          <dt>日期</dt>
          <dd>{formatDateCn(record.date, record.time)}</dd>
          <dt>场馆</dt>
          <dd>{record.city || "城市待补"} · {record.venue || "场馆待补"}</dd>
          <dt>票座</dt>
          <dd>{record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"} · {record.seat || "座位待补"}</dd>
        </dl>
        <strong>{formatRelativeDay(record.date)}</strong>
      </button>
      <div className="card-actions">
        <IconButton label="打开" onClick={() => onOpen(record)} icon={<Eye />} />
        <IconButton label="编辑" onClick={() => onEdit(record)} icon={<Pencil />} />
      </div>
    </article>
  );
}

function TicketView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return (
    <section className="ticket-grid">
      {records.map((record) => {
        const poster = primaryMedia(record);
        return (
          <button className="memory-ticket" key={record.id} type="button" onClick={() => onOpen(record)}>
            <div className="ticket-poster">{poster ? <img src={poster.src} alt={record.title} /> : <span>{record.title.slice(0, 2)}</span>}</div>
            <div className="ticket-copy">
              <span>{categoryLabels[record.category]}</span>
              <h3>{record.title}</h3>
              <p>{record.artists.join(" / ") || "艺人待补"}</p>
              <dl>
                <dt>日期</dt>
                <dd>{record.date}</dd>
                <dt>场馆</dt>
                <dd>{record.city} · {record.venue}</dd>
                <dt>座位</dt>
                <dd>{record.seat || "座位待补"}</dd>
              </dl>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function PriceView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const priced = [...records].sort((a, b) => (b.price || 0) - (a.price || 0));
  const filledPrices = priced.filter((item) => item.price);
  const average = Math.round(priced.reduce((sum, item) => sum + (item.price || 0), 0) / Math.max(1, filledPrices.length));
  const maxPrice = Math.max(1, ...priced.map((item) => item.price || 0));
  return (
    <section className="price-board">
      <div className="metric-strip">
        <Metric title="记录" value={records.length} hint="当前筛选" />
        <Metric title="已看" value={records.filter((item) => item.status === "watched").length} hint="完成观演" light />
        <Metric title="城市" value={new Set(records.map((item) => item.city).filter(Boolean)).size} hint="足迹" />
        <Metric title="均价" value={`¥${average || 0}`} hint="按已填票价" light />
      </div>
      <div className="price-table">
        <div className="price-head">
          <span>排序</span>
          <span>演出</span>
          <span>票价进度</span>
          <span>座位</span>
        </div>
        {priced.map((record, index) => (
          <button className="price-row" key={record.id} type="button" onClick={() => onOpen(record)}>
            <span className="price-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="price-title">{record.title}<em>{record.artists.join(" / ") || "艺人待补"} · {record.date} · {record.city}</em></span>
            <span className="price-meter" style={{ "--price-ratio": `${Math.max(6, Math.round(((record.price || 0) / maxPrice) * 100))}%` } as CSSProperties}>
              <i />
              <strong>{record.price ? `¥${record.price}` : record.publicPriceRange || "待补"}</strong>
            </span>
            <span>{record.seat || "座位待补"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TimelineView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const ordered = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date)), [records]);
  const years = useMemo(() => unique(ordered.map((record) => record.date.slice(0, 4))).sort((a, b) => b.localeCompare(a)), [ordered]);
  const [yearIndex, setYearIndex] = useState(0);
  const yearRefs = useRef<Record<string, HTMLDivElement | null>>({});
  function jumpToYear(index: number) {
    const nextIndex = Math.min(years.length - 1, Math.max(0, index));
    setYearIndex(nextIndex);
    yearRefs.current[years[nextIndex]]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <div className="timeline-shell">
      <aside className="timeline-rail" aria-label="年份快速定位">
        <strong>{years[yearIndex] || "时间"}</strong>
        <input
          aria-label="拖动定位年份"
          max={Math.max(0, years.length - 1)}
          min={0}
          onChange={(event) => jumpToYear(Number(event.target.value))}
          type="range"
          value={yearIndex}
        />
        <div>
          {years.map((year, index) => (
            <button className={index === yearIndex ? "is-active" : ""} key={year} type="button" onClick={() => jumpToYear(index)}>
              {year}
            </button>
          ))}
        </div>
      </aside>
      <div className="timeline">
        {years.map((year) => (
          <div className="timeline-year" key={year} ref={(node) => { yearRefs.current[year] = node; }}>
            <h2>{year}</h2>
            {ordered.filter((record) => record.date.startsWith(year)).map((record) => {
              const poster = primaryMedia(record);
              return (
                <button className="timeline-item" key={record.id} type="button" onClick={() => onOpen(record)}>
                  <time>
                    <span>{record.date.slice(0, 4)}</span>
                    <strong>{record.date.slice(5).replace("-", ".")}</strong>
                  </time>
                  <div className="timeline-thumb">{poster ? <img src={poster.src} alt="" /> : <Ticket />}</div>
                  <div>
                    <span className="timeline-type">{categoryLabels[record.category]}</span>
                    <h3>{record.title}</h3>
                    <p>{record.artists.join(" / ")} · {record.city} · {record.venue}</p>
                    <small>{record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"} · {record.seat || "座位待补"}</small>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

type AMapNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => AMapInstance;
  Marker: new (options: Record<string, unknown>) => unknown;
  Geocoder?: new (options: Record<string, unknown>) => AMapGeocoder;
  Pixel?: new (x: number, y: number) => unknown;
};

type AMapInstance = {
  add: (items: unknown[]) => void;
  setFitView: (items?: unknown[], immediately?: boolean, padding?: number[]) => void;
  destroy: () => void;
};

type AMapGeocoder = {
  getLocation: (address: string, callback: (status: string, result: AMapGeocoderResult) => void) => void;
};

type AMapGeocoderResult = {
  geocodes?: Array<{
    location?: {
      lng: number;
      lat: number;
    };
  }>;
};

type MapPoint = {
  lng: number;
  lat: number;
  title: string;
  count: number;
};

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
    __liveMemoryAmapPromise?: Promise<AMapNamespace>;
  }
}

function SummaryView({ records }: { records: EventRecord[] }) {
  const artistRows = topRows(records.flatMap((record) => record.artists));
  const cityRows = topRows(records.map((record) => record.city).filter(Boolean));
  const tagRows = topRows(records.flatMap((record) => record.tags));
  return (
    <section className="summary-grid">
      <SummaryPanel title="常看艺人" rows={artistRows} />
      <SummaryPanel title="城市足迹" rows={cityRows} />
      <SummaryPanel title="标签热度" rows={tagRows} />
    </section>
  );
}

function SummaryPanel({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <div className="panel summary-panel">
      <h2>{title}</h2>
      {rows.map(([label, value]) => (
        <div className="bar-row" key={label}>
          <span>{label}</span>
          <div><i style={{ width: `${(value / max) * 100}%` }} /></div>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function CalendarView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const groups = groupBy(records, (record) => record.date.slice(0, 7));
  return (
    <section className="calendar-list">
      {Object.entries(groups).map(([month, items]) => (
        <div className="month-block" key={month}>
          <h2>{month.replace("-", " / ")}</h2>
          <div>
            {items.map((record) => (
              <button key={record.id} type="button" onClick={() => onOpen(record)}>
                <strong>{record.date.slice(8)}</strong>
                <span>{record.title}</span>
                <em>{record.city}</em>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function VenueView({ records, settings }: { records: EventRecord[]; settings: AppSettings }) {
  const cities = topRows(records.map((record) => record.city).filter(Boolean), 20);
  const venues = topRows(records.map((record) => `${record.city} · ${record.venue}`).filter(Boolean), 20);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const activeProvider = settings.map.provider === "none" && settings.map.amapKey.trim() ? "amap" : settings.map.provider;
  const [mapState, setMapState] = useState(activeProvider === "amap" ? "地图准备中" : "未启用真实地图");

  useEffect(() => {
    let cancelled = false;
    let map: AMapInstance | null = null;

    async function drawMap() {
      if (activeProvider !== "amap") {
        setMapState("选择高德地图并保存后加载真实底图");
        return;
      }
      const key = settings.map.amapKey.trim();
      if (!key) {
        setMapState("缺少高德 Web Key");
        return;
      }
      if (!mapRef.current) return;
      try {
        setMapState("正在加载高德地图");
        const AMap = await loadAmap(key, settings.map.amapSecurityCode.trim());
        if (cancelled || !mapRef.current) return;
        const points = await resolveMapPoints(AMap, records);
        if (cancelled || !mapRef.current) return;
        map = new AMap.Map(mapRef.current, {
          center: [104.195397, 35.86166],
          zoom: 4.2,
          mapStyle: "amap://styles/normal",
          resizeEnable: true,
        });
        const markers = points.map((point) => new AMap.Marker({
          position: [point.lng, point.lat],
          title: `${point.title} · ${point.count} 场`,
          label: {
            content: `<span class="amap-memory-label">${point.title}<b>${point.count}</b></span>`,
            direction: "top",
          },
        }));
        if (markers.length) {
          map.add(markers);
          map.setFitView(markers, false, [72, 72, 72, 72]);
        }
        setMapState(markers.length ? `已显示 ${markers.length} 个城市/场馆点位` : "没有可定位的城市或场馆");
      } catch (error) {
        setMapState(error instanceof Error ? error.message : "地图加载失败");
      }
    }

    void drawMap();
    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [activeProvider, records, settings.map.amapKey, settings.map.amapSecurityCode]);

  return (
    <section className="venue-view">
      <div className="map-stage">
        <div className="map-canvas" ref={mapRef}>
          {activeProvider !== "amap" && (
            <div className="map-fallback">
              <MapIcon size={28} />
              <h2>全国足迹</h2>
              <p>{settings.map.provider === "baidu" ? "百度地图配置位已保留；当前版本先启用高德真实底图。" : "在设置里选择高德地图并保存 Web Key 后，这里会加载真实底图。"}</p>
              <div className="city-cloud">
                {cities.map(([city, count]) => (
                  <span key={city} style={{ "--size": `${Math.min(2.2, 1 + count / 4)}rem` } as CSSProperties}>
                    {city}<b>{count}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="map-status">{mapState}</p>
      </div>
      <div className="panel venue-list">
        <h2>常去场馆</h2>
        {venues.map(([venue, count]) => (
          <p key={venue}><span>{venue}</span><b>{count}</b></p>
        ))}
      </div>
    </section>
  );
}

function loadAmap(key: string, securityCode: string) {
  if (typeof window === "undefined") return Promise.reject(new Error("当前环境不能加载地图"));
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
  if (window.__liveMemoryAmapPromise) return window.__liveMemoryAmapPromise;
  window.__liveMemoryAmapPromise = new Promise<AMapNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.liveMemoryAmap = "true";
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`;
    script.onload = () => {
      if (window.AMap?.Map) resolve(window.AMap);
      else reject(new Error("高德地图脚本已加载，但地图对象不可用"));
    };
    script.onerror = () => reject(new Error("高德地图加载失败，请检查 Key、服务绑定和网络"));
    document.head.appendChild(script);
  }).catch((error) => {
    window.__liveMemoryAmapPromise = undefined;
    throw error;
  });
  return window.__liveMemoryAmapPromise;
}

async function resolveMapPoints(AMap: AMapNamespace, records: EventRecord[]) {
  const grouped = new Map<string, { title: string; count: number; address: string; fallback?: [number, number] }>();
  for (const record of records) {
    const title = record.city || record.venue || "未知";
    if (!title) continue;
    const key = `${record.city}|${record.venue}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    const fallback = cityLngLat(record.city);
    grouped.set(key, {
      title,
      count: 1,
      address: [record.city, record.address, record.venue].filter(Boolean).join(" "),
      fallback,
    });
  }
  const points: MapPoint[] = [];
  const geocoder = AMap.Geocoder ? new AMap.Geocoder({ city: "全国" }) : null;
  for (const item of Array.from(grouped.values()).slice(0, 80)) {
    const resolved = item.fallback || (geocoder ? await geocodeAddress(geocoder, item.address) : undefined);
    if (!resolved) continue;
    points.push({ title: item.title, count: item.count, lng: resolved[0], lat: resolved[1] });
  }
  return points;
}

function geocodeAddress(geocoder: AMapGeocoder, address: string) {
  return new Promise<[number, number] | undefined>((resolve) => {
    if (!address.trim()) {
      resolve(undefined);
      return;
    }
    geocoder.getLocation(address, (status, result) => {
      const location = status === "complete" ? result.geocodes?.[0]?.location : undefined;
      resolve(location ? [location.lng, location.lat] : undefined);
    });
  });
}

function cityLngLat(city: string): [number, number] | undefined {
  const normalized = city.replace(/市$/, "").trim();
  const centers: Record<string, [number, number]> = {
    北京: [116.4074, 39.9042],
    上海: [121.4737, 31.2304],
    广州: [113.2644, 23.1291],
    深圳: [114.0579, 22.5431],
    杭州: [120.1551, 30.2741],
    南京: [118.7969, 32.0603],
    苏州: [120.5853, 31.2989],
    成都: [104.0665, 30.5723],
    重庆: [106.5516, 29.563],
    武汉: [114.3055, 30.5928],
    郑州: [113.6254, 34.7466],
    洛阳: [112.454, 34.6197],
    西安: [108.9398, 34.3416],
    长沙: [112.9388, 28.2282],
    厦门: [118.0894, 24.4798],
    福州: [119.2965, 26.0745],
    青岛: [120.3826, 36.0671],
    济南: [117.1201, 36.6512],
    天津: [117.2009, 39.0842],
    沈阳: [123.4315, 41.8057],
    大连: [121.6147, 38.914],
    哈尔滨: [126.6424, 45.756],
    合肥: [117.2272, 31.8206],
    南昌: [115.8582, 28.6829],
    昆明: [102.8329, 24.8801],
    贵阳: [106.6302, 26.647],
    南宁: [108.3669, 22.817],
    海口: [110.1983, 20.044],
    三亚: [109.5119, 18.2528],
    乌鲁木齐: [87.6168, 43.8256],
    呼和浩特: [111.7492, 40.8426],
    银川: [106.2309, 38.4872],
    兰州: [103.8343, 36.0611],
    西宁: [101.7782, 36.6171],
    拉萨: [91.1322, 29.6604],
    太原: [112.5489, 37.8706],
    石家庄: [114.5149, 38.0428],
    宁波: [121.5503, 29.8746],
    温州: [120.6994, 27.9943],
    无锡: [120.3124, 31.4909],
    常州: [119.9737, 31.8107],
  };
  return centers[normalized];
}

function ListView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return (
    <section className="list-view">
      {records.map((record) => (
        <button key={record.id} type="button" onClick={() => onOpen(record)}>
          <span>{record.date}</span>
          <strong>{record.title}</strong>
          <em>{record.artists.join(" / ")}</em>
          <span>{record.city} · {record.venue}</span>
          <b>{record.price ? `¥${record.price}` : "待补"}</b>
        </button>
      ))}
    </section>
  );
}

function StatsView({ records, allRecords }: { records: EventRecord[]; allRecords: EventRecord[] }) {
  const watched = allRecords.filter((record) => record.status === "watched");
  const future = allRecords.filter((record) => record.status !== "watched");
  const totalPrice = watched.reduce((sum, record) => sum + (record.price || 0), 0);
  return (
    <section className="stats">
      <div className="metric-strip">
        <Metric title="总记录" value={allRecords.length} hint="全部档案" />
        <Metric title="已看" value={watched.length} hint="完成观演" light />
        <Metric title="待看" value={future.length} hint="未来计划" />
        <Metric title="总票价" value={`¥${totalPrice}`} hint="按已填票价" light />
      </div>
      <SummaryView records={records} />
    </section>
  );
}

function BackupView({ records, onReplace }: { records: EventRecord[]; onReplace: (records: EventRecord[], message: string) => Promise<void> }) {
  async function importJson(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(rows)) throw new Error("备份文件格式不正确");
    await onReplace(rows as EventRecord[], `已导入 ${rows.length} 条记录`);
  }
  return (
    <section className="backup-grid">
      <div className="panel">
        <h2>完整备份</h2>
        <p>导出包含全部记录、票根、座位图和本地图片数据。发布到 GitHub 后，也建议定期保留这个备份。</p>
        <button className="button primary" type="button" onClick={() => exportJson(records)}>
          <Download size={18} />
          导出 JSON
        </button>
        <button className="button ghost" type="button" onClick={() => exportCsv(records)}>
          <Download size={18} />
          导出 CSV
        </button>
      </div>
      <label className="panel import-file">
        <Upload />
        <strong>导入备份</strong>
        <span>选择之前导出的 JSON 文件恢复或迁移到新设备。</span>
        <input type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && importJson(event.target.files[0])} />
      </label>
    </section>
  );
}

function SettingsView({
  settings,
  onSave,
  records,
  health,
  setRecords,
  flash,
  busy,
  setBusy,
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  records: EventRecord[];
  health: ReturnType<typeof storageHealth>;
  setRecords: (records: EventRecord[]) => void;
  flash: (message: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [password, setPassword] = useState("");
  const [userLabel, setUserLabel] = useState("未登录");
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    let alive = true;
    if (!hasSupabaseConfig(settings)) {
      setUserLabel("未配置同步");
      return () => {
        alive = false;
      };
    }
    currentUser(settings)
      .then((user) => {
        if (alive) setUserLabel(userDisplayName(user));
      })
      .catch(() => {
        if (alive) setUserLabel("未登录");
      });
    return () => {
      alive = false;
    };
  }, [settings.supabase.url, settings.supabase.anonKey]);
  const syncSelected = draft.storageMode === "supabase";
  const syncReady = syncSelected && hasSupabaseConfig(draft);

  function chooseStorageMode(storageMode: AppSettings["storageMode"]) {
    const next = { ...draft, storageMode };
    setDraft(next);
    void onSave(next);
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      flash(label);
    } catch (error) {
      flash(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-page">
      <header className="settings-topline">
        <div>
          <span>Settings</span>
          <h2>私人档案设置</h2>
          <p>公开站点只保留 3 条演示记录。你的完整演出档案只存在于当前浏览器、自己的 Supabase 或你导出的备份文件。</p>
        </div>
        <strong>{storageLocationLabel(draft)}</strong>
      </header>

      <section className="panel storage-location-panel">
        <header className="panel-heading">
          <div>
            <span>保存</span>
            <h2>数据保存位置</h2>
          </div>
          <p>先选位置，再决定是否登录同步。</p>
        </header>
        <div className="storage-choice-grid">
          <button className={draft.storageMode === "local" ? "storage-choice is-active" : "storage-choice"} type="button" onClick={() => chooseStorageMode("local")}>
            <span>01</span>
            <strong>{storageModeLabels.local}</strong>
            <em>只保存在这台设备；换设备时用 JSON 备份迁移。</em>
          </button>
          <button className={draft.storageMode === "supabase" ? "storage-choice is-active" : "storage-choice"} type="button" onClick={() => chooseStorageMode("supabase")}>
            <span>02</span>
            <strong>{storageModeLabels.supabase}</strong>
            <em>{hasSupabaseConfig(draft) ? "登录后可在不同设备之间同步。" : "需要在下方填写 URL 和 anon key。"}</em>
          </button>
        </div>
      </section>

      <div className="settings-content-grid">
        {syncSelected ? (
          <section className="panel sync-settings-panel">
            <header className="panel-heading">
              <div>
                <span>同步</span>
                <h2>我的 Supabase</h2>
              </div>
              <p>每个登录用户只读写自己的记录和图片。</p>
            </header>
            <div className="sync-guide-steps">
              <span>1 填项目 URL 和 anon key</span>
              <span>2 登录账号</span>
              <span>3 推送或拉取自己的数据</span>
            </div>
            <div className="field-stack">
              <label className="field">Project URL<input value={draft.supabase.url} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, url: event.target.value } })} placeholder="https://xxxx.supabase.co" /></label>
              <label className="field">anon public key<input type="password" value={draft.supabase.anonKey} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, anonKey: event.target.value } })} placeholder="eyJ..." /></label>
              <label className="field">媒体桶<input value={draft.supabase.mediaBucket} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, mediaBucket: event.target.value } })} placeholder="echo-media" /></label>
              <label className="field">邮箱<input value={draft.supabase.email} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, email: event.target.value } })} placeholder="you@example.com" /></label>
              <label className="field">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Supabase Auth 密码" /></label>
            </div>
            <div className="button-row">
              <button className="button primary" disabled={!syncReady || busy} type="button" onClick={() => run("已登录", async () => { await onSave(draft); const message = await signInWithPassword(draft, password); flash(message); const user = await currentUser(draft); setUserLabel(userDisplayName(user)); })}>
                {busy ? <Loader2 className="spin" /> : <ShieldCheck size={18} />}
                登录/注册
              </button>
              <button className="button ghost" disabled={!syncReady || busy} type="button" onClick={() => run("前往 GitHub 授权", async () => { await onSave(draft); const message = await signInWithGithub(draft); flash(message); })}>
                <Github size={18} />
                GitHub 登录
              </button>
              <button className="button ghost" type="button" onClick={() => run("已退出", async () => { await signOut(draft); setUserLabel("未登录"); })}>退出</button>
              <button className="button ghost" disabled={!syncReady} type="button" onClick={() => run("已检查", async () => { const user = await currentUser(draft); setUserLabel(userDisplayName(user)); })}>检查登录</button>
            </div>
            <p className="hint">登录状态：{userLabel}</p>
            <div className="button-row">
              <button className="button primary" disabled={!syncReady || busy} type="button" onClick={() => run("我的云端数据已更新", async () => { const result = await pushRecordsToSupabase(draft, records); setRecords(result.records); await onSave({ ...draft, lastSyncAt: nowIso() }); })}>
                <Upload size={18} />
                推送我的数据
              </button>
              <button className="button ghost" disabled={!syncReady || busy} type="button" onClick={() => run("已拉取我的数据", async () => { const result = await pullRecordsFromSupabase(draft); await replaceAllRecords(result.records); setRecords(result.records); await onSave({ ...draft, lastSyncAt: nowIso() }); })}>
                <Download size={18} />
                拉取我的数据
              </button>
            </div>
          </section>
        ) : (
          <section className="panel sync-guide-panel">
            <header className="panel-heading">
              <div>
                <span>同步</span>
                <h2>当前为单设备保存</h2>
              </div>
              <p>需要电脑和手机同步时，再切换到我的 Supabase。</p>
            </header>
            <div className="sync-guide-steps">
              <span>本机可离线使用</span>
              <span>导出 JSON 可迁移</span>
              <span>Supabase 后续开启</span>
            </div>
            <button className="button primary" type="button" onClick={() => chooseStorageMode("supabase")}>
              <Cloud size={18} />
              开启私人同步设置
            </button>
          </section>
        )}

        <section className="settings-side-stack">
          <div className="panel">
            <header className="panel-heading">
              <div>
                <span>显示</span>
                <h2>默认视图</h2>
              </div>
            </header>
            <label className="field">
              默认视图
              <select value={draft.defaultView} onChange={(event) => setDraft({ ...draft, defaultView: event.target.value as ArchiveView })}>
                {(Object.keys(viewLabels) as ArchiveView[]).map((item) => <option key={item} value={item}>{viewLabels[item]}</option>)}
              </select>
            </label>
            <label className="field">
              海报每行
              <select value={draft.posterColumns} onChange={(event) => setDraft({ ...draft, posterColumns: Number(event.target.value) })}>
                {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 张</option>)}
              </select>
            </label>
            <button className="button primary" type="button" onClick={() => onSave(draft)}>
              <Check size={18} />
              保存显示设置
            </button>
          </div>

          <div className="panel">
            <header className="panel-heading">
              <div>
                <span>地图</span>
                <h2>底图接口</h2>
              </div>
            </header>
            <label className="field">地图提供方<select value={draft.map.provider} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, provider: event.target.value as AppSettings["map"]["provider"] } })}><option value="none">暂不加载</option><option value="amap">高德地图</option><option value="baidu">百度地图</option></select></label>
            <label className="field">高德 Web Key<input type="password" value={draft.map.amapKey} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapKey: event.target.value } })} placeholder="只保存在你的浏览器设置里" /></label>
            <label className="field">高德 securityJsCode<input type="password" value={draft.map.amapSecurityCode} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapSecurityCode: event.target.value } })} placeholder="如控制台要求安全密钥则填写" /></label>
            <label className="field">百度 JSAPI GL AK<input type="password" value={draft.map.baiduAk} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, baiduAk: event.target.value } })} /></label>
            <p className="hint">地图 Key 不会提交到 GitHub；但浏览器调用地图服务时，服务商仍能在请求中识别这个 Web Key。</p>
            <div className="button-row">
              <button className="button primary" type="button" onClick={() => onSave({ ...draft, map: { ...draft.map, provider: "amap" } })}>
                <MapIcon size={18} />
                启用高德并保存
              </button>
              <button className="button ghost" type="button" onClick={() => onSave(draft)}>保存地图设置</button>
            </div>
          </div>
        </section>
      </div>

      <section className="panel health settings-health-panel">
        <header className="panel-heading">
          <div>
            <span>检查</span>
            <h2>存储健康</h2>
          </div>
        </header>
        <InfoLine label="本地记录" value={`${health.localRecords} 条`} />
        <InfoLine label="图片附件" value={`${health.mediaAssets} 个`} />
        <InfoLine label="未上传图片" value={`${health.localOnlyMedia} 个`} />
        <InfoLine label="远程图片" value={`${health.remoteMedia} 个`} />
        <InfoLine label="最近同步" value={health.lastSyncAt ? new Date(health.lastSyncAt).toLocaleString("zh-CN") : "尚未同步"} />
      </section>
    </section>
  );
}

function userDisplayName(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) return "未登录";
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const handle = ["user_name", "preferred_username", "name"]
    .map((key) => metadata?.[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return user.email || handle || "已登录";
}

function storageLocationLabel(settings: AppSettings) {
  if (settings.storageMode === "supabase") {
    return hasSupabaseConfig(settings) ? "保存：我的 Supabase" : "保存位置待配置";
  }
  return "保存：当前浏览器";
}

function statusClass(status: EventStatus) {
  return `status-${status}`;
}

function DetailDrawer({
  record,
  onClose,
  onEdit,
  onDelete,
  onZoom,
  onSave,
}: {
  record: EventRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onZoom: (media: MediaAsset) => void;
  onSave: (record: EventRecord) => Promise<void>;
}) {
  const poster = primaryMedia(record);
  const seatMaps = mediaByKind(record, "seatMap");
  const photos = mediaByKind(record, "livePhoto");
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside className="detail-drawer">
        <header>
          <button className="icon" type="button" onClick={onClose} aria-label="关闭"><X /></button>
          <div className="drawer-actions">
            <IconButton label={record.favorite ? "取消收藏" : "收藏"} icon={<Heart />} onClick={() => onSave({ ...record, favorite: !record.favorite })} />
            <IconButton label="编辑" icon={<Pencil />} onClick={onEdit} />
            <IconButton label="删除" icon={<Trash2 />} danger onClick={onDelete} />
          </div>
        </header>
        <section className="detail-hero">
          <button className="detail-poster" type="button" onClick={() => poster && onZoom(poster)}>
            {poster ? <img src={poster.src} alt={record.title} /> : <ImagePlus />}
          </button>
          <div>
            <span className="badge">{categoryLabels[record.category]} · {statusLabels[record.status]}</span>
            <h2>{record.title}</h2>
            <p>{record.artists.join(" / ") || "艺人待补"}</p>
            <div className="detail-facts">
              <InfoLine label="日期" value={formatDateCn(record.date, record.time)} />
              <InfoLine label="场馆" value={`${record.city || "城市待补"} | ${record.venue || "场馆待补"}`} />
              <InfoLine label="票价" value={record.price ? `¥${record.price}` : record.publicPriceRange || "未填票价"} />
              <InfoLine label="座位" value={record.seat || "座位待补"} />
              <InfoLine label="同行" value={record.companions.join(" / ") || "未记录"} />
              <InfoLine label="来源" value={sourceLabels[record.sourceChannel]} />
            </div>
            {record.sourceUrl && <a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />打开来源页</a>}
          </div>
        </section>
        <MediaSection title="座位图" items={seatMaps} onZoom={onZoom} />
        <MediaSection title="现场精选" items={photos} onZoom={onZoom} />
        <section className="detail-section">
          <h3>标签与记录</h3>
          <div className="tag-row">{record.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <p>{record.note || "还没有写下现场记忆。"}</p>
          {record.setlist.length > 0 && <ol className="setlist">{record.setlist.map((song) => <li key={song}>{song}</li>)}</ol>}
        </section>
      </aside>
    </div>
  );
}

function MediaSection({ title, items, onZoom }: { title: string; items: MediaAsset[]; onZoom: (media: MediaAsset) => void }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {items.length ? (
        <div className="media-grid">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => onZoom(item)}>
              <img src={item.src} alt={item.title || mediaKindLabels[item.kind]} />
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-line">暂未保存{title}。</p>
      )}
    </section>
  );
}

function RecordEditor({ record, onCancel, onSave }: { record: EventRecord; onCancel: () => void; onSave: (record: EventRecord) => Promise<void> }) {
  const [draft, setDraft] = useState(record);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await onSave({
      ...draft,
      lineup: draft.artists.map((name) => ({ name, role: "artist" })),
      updatedAt: nowIso(),
    });
    setSaving(false);
  }

  async function addFiles(kind: "poster" | "ticket" | "seatMap" | "livePhoto", files: FileList | null) {
    if (!files?.length) return;
    const media = await Promise.all(Array.from(files).map((file) => fileToMedia(draft.id, kind, file)));
    setDraft((current) => ({
      ...current,
      media: kind === "poster" || kind === "ticket" || kind === "seatMap"
        ? current.media.filter((item) => item.kind !== kind).concat(media)
        : current.media.concat(media),
    }));
  }

  return (
    <div className="modal-backdrop">
      <form className="editor" onSubmit={submit}>
        <header>
          <div>
            <p>Record editor</p>
            <h2>{record.title ? "编辑演出" : "新增演出"}</h2>
          </div>
          <button className="icon" type="button" onClick={onCancel}><X /></button>
        </header>
        <div className="form-grid">
          <label className="field wide">名称<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="field wide">演员 / 歌手阵容<input value={draft.artists.join(" / ")} onChange={(event) => setDraft({ ...draft, artists: splitTextList(event.target.value) })} placeholder="多个用 / 或 、 分隔" /></label>
          <label className="field">类型<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as EventCategory })}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field">状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EventStatus })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field">日期<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
          <label className="field">时间<input type="time" value={draft.time || ""} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
          <label className="field">城市<input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
          <label className="field">场馆<input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></label>
          <label className="field">票价<input type="number" value={draft.price ?? ""} onChange={(event) => setDraft({ ...draft, price: event.target.value ? Number(event.target.value) : null })} /></label>
          <label className="field">公开票价<input value={draft.publicPriceRange || ""} onChange={(event) => setDraft({ ...draft, publicPriceRange: event.target.value })} /></label>
          <label className="field wide">座位<input value={draft.seat || ""} onChange={(event) => setDraft({ ...draft, seat: event.target.value })} /></label>
          <label className="field wide">同行人<input value={draft.companions.join(" / ")} onChange={(event) => setDraft({ ...draft, companions: splitTextList(event.target.value) })} /></label>
          <label className="field wide">标签<input value={draft.tags.join(" / ")} onChange={(event) => setDraft({ ...draft, tags: splitTextList(event.target.value) })} /></label>
          <label className="field wide">来源链接<input value={draft.sourceUrl || ""} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></label>
          <label className="upload-card">票根/海报<input type="file" accept="image/*" onChange={(event) => addFiles("poster", event.target.files)} /></label>
          <label className="upload-card">电子票根<input type="file" accept="image/*" onChange={(event) => addFiles("ticket", event.target.files)} /></label>
          <label className="upload-card">座位图<input type="file" accept="image/*" onChange={(event) => addFiles("seatMap", event.target.files)} /></label>
          <label className="upload-card">现场精选<input type="file" accept="image/*" multiple onChange={(event) => addFiles("livePhoto", event.target.files)} /></label>
          <div className="wide preview-strip">{draft.media.map((item) => <img key={item.id} src={item.src} alt={item.title || ""} />)}</div>
          <label className="field wide">曲目<textarea value={draft.setlist.join("\n")} onChange={(event) => setDraft({ ...draft, setlist: splitTextList(event.target.value) })} /></label>
          <label className="field wide">现场记忆<textarea value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onCancel}>取消</button>
          <button className="button primary" disabled={saving} type="submit">{saving ? <Loader2 className="spin" /> : <Check size={18} />}保存</button>
        </footer>
      </form>
    </div>
  );
}

function ImportDrawer({ onClose, onSave, flash }: { onClose: () => void; onSave: (record: EventRecord) => Promise<void>; flash: (message: string) => void }) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [loading, setLoading] = useState(false);

  async function parse() {
    setLoading(true);
    const next = await createDraftsFromText(text);
    setDrafts(next);
    setLoading(false);
    flash(`生成 ${next.length} 条草稿`);
  }

  async function importImages(files: FileList | null) {
    if (!files?.length) return;
    const nextDrafts: ImportDraft[] = Array.from(files).map((file) => ({
      id: createId("draft"),
      title: file.name.replace(/\.[^.]+$/, ""),
      category: "concert",
      status: "watched",
      date: new Date().toISOString().slice(0, 10),
      city: "",
      venue: "",
      artists: [],
      sourceChannel: "",
      note: "由批量图片导入生成，请补充演出基础信息。",
      importConfidence: 0.35,
    }));
    setDrafts((current) => current.concat(nextDrafts));
    for (let index = 0; index < files.length; index += 1) {
      const record = draftToRecord(nextDrafts[index]);
      record.media = [await fileToMedia(record.id, "poster", files[index])];
      await onSave(record);
    }
    flash(`已导入 ${files.length} 张图片草稿`);
  }

  async function saveDraft(draft: ImportDraft) {
    await onSave(draftToRecord(draft));
  }

  return (
    <div className="drawer-backdrop">
      <aside className="import-drawer">
        <header>
          <div>
            <p>Batch import</p>
            <h2>批量添加</h2>
          </div>
          <button className="icon" type="button" onClick={onClose}><X /></button>
        </header>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴多条大麦链接、演出文字，或手机提取文字结果。每条链接会生成一条可编辑草稿。" />
        <div className="button-row">
          <button className="button primary" disabled={loading} type="button" onClick={parse}>{loading ? <Loader2 className="spin" /> : <Sparkles size={18} />}识别草稿</button>
          <label className="button ghost"><ImagePlus size={18} />批量图片<input type="file" accept="image/*" multiple onChange={(event) => importImages(event.target.files)} /></label>
        </div>
        <div className="draft-list">
          {drafts.map((draft) => (
            <article key={draft.id}>
              {draft.posterUrl && <img src={draft.posterUrl} alt="" />}
              <div>
                <span>{categoryLabels[draft.category]} · 置信度 {Math.round(draft.importConfidence * 100)}%</span>
                <h3>{draft.title}</h3>
                <p>{draft.date} · {draft.city || "城市待补"} · {draft.venue || "场馆待补"}</p>
              </div>
              <button className="button primary" type="button" onClick={() => saveDraft(draft)}>加入档案</button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ImageZoom({ media, onClose }: { media: MediaAsset; onClose: () => void }) {
  return (
    <div className="zoom-backdrop" onClick={onClose}>
      <button className="icon zoom-close" type="button" onClick={onClose}><X /></button>
      <img src={media.src} alt={media.title || ""} onClick={(event) => event.stopPropagation()} />
      <div className="zoom-tools">
        <a className="button primary" href={media.src} download={media.title || "echo-media"}><Download size={18} />下载</a>
        <button className="button ghost" type="button" onClick={() => navigator.clipboard?.writeText(media.src)}><Copy size={18} />复制地址</button>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="info-line">
      <span>{label}</span>
      <b>{value}</b>
    </p>
  );
}

function IconButton({ label, icon, onClick, danger }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`icon-action ${danger ? "danger" : ""}`} type="button" title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

function Metric({ title, value, hint, light }: { title: string; value: ReactNode; hint: string; light?: boolean }) {
  return (
    <div className={`metric ${light ? "light" : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <em>{hint}</em>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <Ticket />
      <h2>还没有匹配的演出</h2>
      <p>换一个筛选条件，或者从大麦链接、截图、图片开始批量添加。</p>
    </section>
  );
}

function viewIcon(view: ArchiveView) {
  const icons: Record<ArchiveView, ReactNode> = {
    poster: <ImagePlus />,
    wallet: <Archive />,
    ticket: <Ticket />,
    timeline: <ChevronDown />,
    price: <CircleDollarSign />,
    summary: <Sparkles />,
    calendar: <CalendarDays />,
    venue: <MapIcon />,
    list: <List />,
  };
  return icons[view];
}

function filterRecords(records: EventRecord[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (query) {
      const text = [record.title, record.city, record.venue, record.artists.join(" "), record.tags.join(" "), record.note].join(" ").toLowerCase();
      if (!text.includes(query)) return false;
    }
    if (filters.categories.length && !filters.categories.includes(record.category)) return false;
    if (filters.statuses.length && !filters.statuses.includes(record.status)) return false;
    if (filters.years.length && !filters.years.includes(record.date.slice(0, 4))) return false;
    if (filters.cities.length && !filters.cities.includes(record.city)) return false;
    if (filters.artists.length && !record.artists.some((artist) => filters.artists.includes(artist))) return false;
    if (filters.tags.length && !record.tags.some((tag) => filters.tags.includes(tag))) return false;
    return true;
  });
}

function sortRecords(records: EventRecord[], sort: SortMode) {
  const next = [...records];
  if (sort === "date-asc") return next.sort((a, b) => a.date.localeCompare(b.date));
  if (sort === "price-desc") return next.sort((a, b) => (b.price || 0) - (a.price || 0));
  if (sort === "updated-desc") return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === "smart") {
    return next.sort((a, b) => {
      const aFuture = daysFromToday(a.date) >= 0 ? 1 : 0;
      const bFuture = daysFromToday(b.date) >= 0 ? 1 : 0;
      if (aFuture !== bFuture) return bFuture - aFuture;
      return b.date.localeCompare(a.date);
    });
  }
  return next.sort((a, b) => b.date.localeCompare(a.date));
}

function buildFacets(records: EventRecord[]) {
  return {
    categories: unique(records.map((record) => record.category)) as EventCategory[],
    statuses: unique(records.map((record) => record.status)) as EventStatus[],
    years: unique(records.map((record) => record.date.slice(0, 4))).sort((a, b) => b.localeCompare(a)),
    cities: unique(records.map((record) => record.city).filter(Boolean)),
    artists: unique(records.flatMap((record) => record.artists)).slice(0, 24),
    tags: unique(records.flatMap((record) => record.tags)).slice(0, 24),
  };
}

function unique<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : values.concat(value);
}

function topRows(values: string[], limit = 8): [string, number][] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, limit);
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const value = key(item);
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}

function draftToRecord(draft: ImportDraft): EventRecord {
  const id = createId("record");
  const timestamp = nowIso();
  return {
    schemaVersion: 2,
    id,
    title: draft.title,
    category: draft.category,
    status: draft.status,
    recordState: "normal",
    date: draft.date,
    time: draft.time,
    city: draft.city,
    venue: draft.venue,
    address: draft.address,
    artists: draft.artists,
    lineup: draft.artists.map((name) => ({ name, role: "artist" })),
    price: draft.price ?? null,
    publicPriceRange: draft.publicPriceRange,
    seat: "",
    companions: [],
    tags: draft.category === "festival" ? ["音乐节", "导入草稿"] : ["导入草稿"],
    note: draft.note || "由公开链接或文本导入，请补充个人票价、座位、同行人和现场照片。",
    setlist: [],
    sourceChannel: draft.sourceChannel,
    sourceUrl: draft.sourceUrl,
    importConfidence: draft.importConfidence,
    media: draft.posterUrl ? [makeMedia(id, "poster", draft.posterUrl, "公开海报", "external")] : [],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function exportJson(records: EventRecord[]) {
  downloadBlob(
    JSON.stringify({ app: "echo-archive", version: 2, exportedAt: nowIso(), records }, null, 2),
    `echo-archive-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}

function exportCsv(records: EventRecord[]) {
  const rows = [["title", "artists", "date", "time", "city", "venue", "price", "seat", "status", "category"]];
  records.forEach((record) => rows.push([record.title, record.artists.join("/"), record.date, record.time || "", record.city, record.venue, String(record.price || ""), record.seat || "", statusLabels[record.status], categoryLabels[record.category]]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(`\ufeff${csv}`, `echo-archive-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
}
