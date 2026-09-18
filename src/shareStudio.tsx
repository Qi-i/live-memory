import {
  ArrowDownWideNarrow,
  Download,
  Grid3X3,
  LayoutTemplate,
  MapPinned,
  Maximize2,
  Minus,
  Palette,
  Plus,
  Rows3,
  Search,
  Ticket,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BrandLockup } from "./brand";
import type { EventCategory, EventRecord, MapConfig } from "./domain";
import { categoryLabels, effectiveStatus, primaryMedia } from "./domain";
import { loadAmap, type AMapLngLatLike, type AMapNamespace } from "./amap";
import { loadMediaImage, preloadRecordMedia, useCachedMediaSrc } from "./mediaCache";
import "./shareStudio.css";

export type ShareFormat =
  | "adaptive-landscape"
  | "adaptive-portrait"
  | "landscape-4-3"
  | "landscape-16-9"
  | "portrait-3-4"
  | "portrait-9-16"
  | "square"
  | "long";
type ShareLayout = "wall" | "tickets" | "timeline" | "magazine" | "cities";
type SharePalette = "jade" | "midnight" | "paper" | "sunset" | "graphite" | "mist" | "forest" | "champagne" | "plum" | "silver";
type ScopeMode = "all" | "range" | "manual";
type ItemLimit = 12 | 20 | 30 | "all";
type SortMode = "date-desc" | "date-asc";

type Rect = { x: number; y: number; width: number; height: number };
type PosterSlot = { record: EventRecord; rect: Rect; emphasis?: "hero" | "feature" | "normal" };
type TimelineBand = { label: string; count: number; rect: Rect; headerHeight: number; slots: PosterSlot[] };
type CityChip = { label: string; count: number };
type ShareMapPoint = { position: [number, number]; title: string; date: string };

interface ShareStudioProps {
  records: EventRecord[];
  format: ShareFormat;
  setFormat: (format: ShareFormat) => void;
  mapSettings: MapConfig;
  onOpenMapSettings: () => void;
  onClose: () => void;
}

interface PaletteDefinition {
  background: [string, string];
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  border: string;
}

interface CanvasSpec {
  format: ShareFormat;
  width: number;
  height: number;
  padding: number;
  headerHeight: number;
  footerHeight: number;
}

interface ExportOptions {
  records: EventRecord[];
  format: ShareFormat;
  layout: ShareLayout;
  palette: SharePalette;
  headline: string;
  showDetails: boolean;
  showBrand: boolean;
  showStats: boolean;
  sortMode: SortMode;
  mapSnapshot?: HTMLCanvasElement | null;
}

const categoryOptions: EventCategory[] = ["concert", "festival", "livehouse", "theatre", "other"];

const layoutOptions: Array<{ value: ShareLayout; label: string; description: string; icon: ReactNode }> = [
  { value: "wall", label: "密集海报墙", description: "按原比例紧密拼接，适合一次分享很多现场", icon: <Grid3X3 /> },
  { value: "tickets", label: "票根聚合", description: "把海报色彩、日期、场馆与座位整理成磨砂票根", icon: <Ticket /> },
  { value: "timeline", label: "时间长卷", description: "按年份分带，突出观演经历的时间脉络", icon: <Rows3 /> },
  { value: "magazine", label: "编目杂志", description: "主视觉、次重点与密集补位形成清晰层级", icon: <LayoutTemplate /> },
  { value: "cities", label: "城市路线", description: "真实高德地图配合密集海报，按现场顺序呈现城市足迹", icon: <MapPinned /> },
];

const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "jade", label: "翡翠绿" },
  { value: "midnight", label: "深海蓝" },
  { value: "paper", label: "极简白" },
  { value: "sunset", label: "暖砂金" },
  { value: "graphite", label: "石墨黑" },
  { value: "mist", label: "雾霭蓝灰" },
  { value: "forest", label: "深林绿" },
  { value: "champagne", label: "香槟米" },
  { value: "plum", label: "午夜紫灰" },
  { value: "silver", label: "冷银" },
];

const palettes: Record<SharePalette, PaletteDefinition> = {
  jade: {
    background: ["#e5f7ef", "#74bca9"], surface: "#f5fbf8", text: "#10201b", muted: "#4d6f64",
    accent: "#0b8f78", accentSoft: "#dfff4f", border: "rgba(11, 86, 73, .18)",
  },
  midnight: {
    background: ["#07151a", "#18384a"], surface: "#102129", text: "#f7fffb", muted: "#9bb1b3",
    accent: "#63dfca", accentSoft: "#dfff4f", border: "rgba(255, 255, 255, .22)",
  },
  paper: {
    background: ["#f8f4eb", "#dfd8ca"], surface: "#fffdf7", text: "#191d1c", muted: "#6e7470",
    accent: "#167e6e", accentSoft: "#d8b17a", border: "rgba(24, 31, 29, .16)",
  },
  sunset: {
    background: ["#f5e5d2", "#c78565"], surface: "#fff5e9", text: "#2d1c19", muted: "#78584f",
    accent: "#8e3d31", accentSoft: "#f0be65", border: "rgba(74, 35, 28, .2)",
  },
  graphite: {
    background: ["#101416", "#303638"], surface: "#1c2224", text: "#f4f5f2", muted: "#aab2ae",
    accent: "#91b7ad", accentSoft: "#d4dcc8", border: "rgba(255, 255, 255, .18)",
  },
  mist: {
    background: ["#e5ecee", "#a7b7bd"], surface: "#f7f9f9", text: "#172126", muted: "#65767d",
    accent: "#557d86", accentSoft: "#d5e8e4", border: "rgba(35, 61, 69, .16)",
  },
  forest: {
    background: ["#0c211b", "#36574a"], surface: "#17342b", text: "#f4f7f1", muted: "#a8bbb3",
    accent: "#79c5aa", accentSoft: "#d9d2a0", border: "rgba(255, 255, 255, .18)",
  },
  champagne: {
    background: ["#f5efe5", "#c9baa4"], surface: "#fffaf2", text: "#2d2822", muted: "#7b6e60",
    accent: "#8b7150", accentSoft: "#e0c88d", border: "rgba(72, 57, 40, .17)",
  },
  plum: {
    background: ["#19151d", "#4c4050"], surface: "#29232e", text: "#faf7fb", muted: "#b6aabb",
    accent: "#bba8c0", accentSoft: "#d8d0bd", border: "rgba(255, 255, 255, .18)",
  },
  silver: {
    background: ["#eef1f2", "#bcc5ca"], surface: "#fbfcfc", text: "#1c2428", muted: "#69777e",
    accent: "#617d89", accentSoft: "#d6e3df", border: "rgba(39, 60, 69, .16)",
  },
};

export function ShareStudio({ records, format, setFormat, mapSettings, onOpenMapSettings, onClose }: ShareStudioProps) {
  const eligibleRecords = useMemo(
    () => records
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)),
    [records],
  );
  const earliestDate = eligibleRecords.length ? eligibleRecords[eligibleRecords.length - 1].date : "";
  const latestDate = eligibleRecords.length ? eligibleRecords[0].date : "";
  const [layout, setLayout] = useState<ShareLayout>("wall");
  const [palette, setPalette] = useState<SharePalette>("jade");
  const [headline, setHeadline] = useState("我的现场档案");
  const [scope, setScope] = useState<ScopeMode>("all");
  const [itemLimit, setItemLimit] = useState<ItemLimit>("all");
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [categories, setCategories] = useState<Set<EventCategory>>(() => new Set<EventCategory>());
  const [startDate, setStartDate] = useState(earliestDate);
  const [endDate, setEndDate] = useState(latestDate);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(eligibleRecords.map((record) => record.id)));
  const [selectionQuery, setSelectionQuery] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [showBrand, setShowBrand] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState("");
  const [fitScale, setFitScale] = useState(0.5);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const previewAreaRef = useRef<HTMLElement | null>(null);

  const years = useMemo(
    () => Array.from(new Set(eligibleRecords.map((record) => record.date.slice(0, 4)).filter(Boolean))).sort((a, b) => b.localeCompare(a)),
    [eligibleRecords],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<EventCategory, number>();
    categoryOptions.forEach((category) => counts.set(category, eligibleRecords.filter((record) => record.category === category).length));
    return counts;
  }, [eligibleRecords]);

  useEffect(() => {
    setStartDate((current) => current || earliestDate);
    setEndDate((current) => current || latestDate);
    setSelectedIds((current) => {
      const valid = new Set(eligibleRecords.filter((record) => current.has(record.id)).map((record) => record.id));
      return valid.size ? valid : new Set(eligibleRecords.map((record) => record.id));
    });
  }, [earliestDate, latestDate, eligibleRecords]);

  const categoryFilteredRecords = useMemo(() => {
    if (!categories.size) return eligibleRecords;
    return eligibleRecords.filter((record) => categories.has(record.category));
  }, [categories, eligibleRecords]);

  const scopedRecords = useMemo(() => {
    if (scope === "range") {
      return categoryFilteredRecords.filter((record) => (!startDate || record.date >= startDate) && (!endDate || record.date <= endDate));
    }
    if (scope === "manual") return categoryFilteredRecords.filter((record) => selectedIds.has(record.id));
    return categoryFilteredRecords;
  }, [categoryFilteredRecords, endDate, scope, selectedIds, startDate]);

  const sortedRecords = useMemo(() => scopedRecords.slice().sort((a, b) => {
    const order = b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt);
    return sortMode === "date-desc" ? order : -order;
  }), [scopedRecords, sortMode]);

  const selectedRecords = useMemo(
    () => itemLimit === "all" ? sortedRecords : sortedRecords.slice(0, itemLimit),
    [itemLimit, sortedRecords],
  );

  const visibleSelectionRecords = useMemo(() => {
    const query = selectionQuery.trim().toLowerCase();
    if (!query) return categoryFilteredRecords;
    return categoryFilteredRecords.filter((record) => [record.title, record.city, record.venue, record.artists.join(" "), record.date]
      .join(" ").toLowerCase().includes(query));
  }, [categoryFilteredRecords, selectionQuery]);

  const period = useMemo(() => formatPeriod(selectedRecords), [selectedRecords]);
  const watched = selectedRecords.filter((record) => effectiveStatus(record) === "watched").length;
  const cities = new Set(selectedRecords.map((record) => record.city).filter(Boolean)).size;
  const spec = useMemo(
    () => getCanvasSpec(format, selectedRecords.length, layout, selectedRecords),
    [format, layout, selectedRecords],
  );
  const effectiveScale = manualScale ?? fitScale;

  const recalculateFit = useCallback(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    const bounds = area.getBoundingClientRect();
    const availableWidth = Math.max(180, bounds.width - 52);
    const toolbarHeight = 54;
    const availableHeight = Math.max(180, bounds.height - toolbarHeight - 40);
    const next = format === "long"
      ? Math.min(1, availableWidth / spec.width)
      : Math.min(1, availableWidth / spec.width, availableHeight / spec.height);
    setFitScale(clamp(next, 0.14, 1));
  }, [format, spec.height, spec.width]);

  useLayoutEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    setManualScale(null);
    recalculateFit();
    const observer = new ResizeObserver(recalculateFit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [format, layout, recalculateFit, selectedRecords.length]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setPreparing(true);
    void preloadRecordMedia(selectedRecords).finally(() => {
      if (active) setPreparing(false);
    });
    return () => { active = false; };
  }, [selectedRecords]);

  function toggleCategory(category: EventCategory) {
    setCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleRecord(recordId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function selectYear(year: string) {
    setScope("range");
    setStartDate(`${year}-01-01`);
    setEndDate(`${year}-12-31`);
  }

  function nudgeScale(delta: number) {
    setManualScale((current) => clamp((current ?? fitScale) + delta, 0.18, 1.35));
  }

  async function savePng() {
    if (saving || !selectedRecords.length) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const mapSnapshot = layout === "cities" ? captureShareAmapSurface() : null;
      await exportSharePng({
        records: selectedRecords,
        format,
        layout,
        palette,
        headline: headline.trim() || "我的现场档案",
        showDetails,
        showBrand,
        showStats,
        sortMode,
        mapSnapshot,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    } catch (caught) {
      console.error("Share PNG export failed", caught);
      setError("图片生成失败。请稍后重试；无法读取的图片会自动改用标题色块。");
    } finally {
      setSaving(false);
    }
  }

  const previewStyle = {
    width: spec.width,
    height: spec.height,
    transform: `scale(${effectiveScale})`,
    "--share-canvas-width": `${spec.width}px`,
    "--share-canvas-height": `${spec.height}px`,
    "--share-content-x": `${spec.padding}px`,
    "--share-content-y": `${spec.padding + spec.headerHeight}px`,
    "--share-content-width": `${spec.width - spec.padding * 2}px`,
    "--share-content-height": `${spec.height - spec.padding * 2 - spec.headerHeight - spec.footerHeight}px`,
  } as CSSProperties;
  const viewportStyle = {
    width: spec.width * effectiveScale,
    height: spec.height * effectiveScale,
  } as CSSProperties;

  return (
    <section className={`share-studio-stage share-theme-${palette}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="share-studio-panel" aria-label="分享图设置">
        <header className="share-studio-heading">
          <BrandLockup compact size={38} />
          <button type="button" aria-label="退出分享制作" title="关闭（Esc）" onClick={onClose}><X /></button>
        </header>

        <div className="share-intro-copy">
          <span>现场分享图</span>
          <h2>选择真正想分享的现场</h2>
          <p>从类型、时间和具体场次中筛选，再选择适合内容的版式。</p>
        </div>

        <div className="share-studio-summary">
          <strong>{selectedRecords.length}</strong><span>项档案进入成图</span><small>{period} · {cities} 个城市 · {sortMode === "date-desc" ? "最新在前" : "最早在前"}</small>
        </div>

        <section className="share-control-group">
          <strong>分享标题</strong>
          <input className="share-headline-input" value={headline} maxLength={24} onChange={(event) => setHeadline(event.target.value)} placeholder="输入分享图标题" />
        </section>

        <section className="share-control-group">
          <strong>演出类型 <small>可多选</small></strong>
          <div className="share-category-control">
            <button className={!categories.size ? "is-active" : ""} type="button" onClick={() => setCategories(new Set<EventCategory>())}>全部 <i>{eligibleRecords.length}</i></button>
            {categoryOptions.map((category) => (
              <button className={categories.has(category) ? "is-active" : ""} key={category} type="button" disabled={!categoryCounts.get(category)} onClick={() => toggleCategory(category)}>
                {categoryLabels[category]} <i>{categoryCounts.get(category) || 0}</i>
              </button>
            ))}
          </div>
        </section>

        <div className="share-control-compact-grid">
        <section className="share-control-group">
          <strong>排序方式</strong>
          <button className="share-sort-button" type="button" onClick={() => setSortMode((current) => current === "date-desc" ? "date-asc" : "date-desc")}>
            <ArrowDownWideNarrow />
            <span><b>按时间 · {sortMode === "date-desc" ? "最新在前" : "最早在前"}</b><small>点击切换顺序</small></span>
          </button>
        </section>

        <section className="share-control-group">
          <strong>选择范围</strong>
          <div className="share-scope-control">
            {(["all", "range", "manual"] as ScopeMode[]).map((item) => (
              <button className={scope === item ? "is-active" : ""} key={item} type="button" onClick={() => setScope(item)}>
                {item === "all" ? "全部记录" : item === "range" ? "按时间" : "逐场选择"}
              </button>
            ))}
          </div>
        </section>
        </div>

        {scope === "range" && (
          <section className="share-range-control">
            <div><label>开始日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>结束日期<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
            <div className="share-year-chips">{years.map((year) => <button type="button" key={year} onClick={() => selectYear(year)}>{year}</button>)}</div>
          </section>
        )}

        {scope === "manual" && (
          <section className="share-selection-browser">
            <label><Search /><input value={selectionQuery} onChange={(event) => setSelectionQuery(event.target.value)} placeholder="搜索标题、城市、场馆或日期" /></label>
            <div className="share-selection-actions">
              <button type="button" onClick={() => setSelectedIds(new Set(visibleSelectionRecords.map((record) => record.id)))}>选择当前结果</button>
              <button type="button" onClick={() => setSelectedIds(new Set<string>())}>清空</button>
            </div>
            <div className="share-selection-grid">
              {visibleSelectionRecords.map((record) => (
                <button className={selectedIds.has(record.id) ? "is-selected" : ""} type="button" key={record.id} onClick={() => toggleRecord(record.id)}>
                  <SharePoster record={record} />
                  <span><b>{record.title}</b><small>{record.date} · {record.city || categoryLabels[record.category]}</small></span>
                  <i>{selectedIds.has(record.id) ? "✓" : ""}</i>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="share-control-compact-grid">
        <section className="share-control-group">
          <strong>最多使用</strong>
          <div className="share-count-control">
            {([12, 20, 30, "all"] as ItemLimit[]).map((count) => (
              <button className={itemLimit === count ? "is-active" : ""} key={count} type="button" onClick={() => setItemLimit(count)}>{count === "all" ? "全部" : `${count} 张`}</button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong>成图比例 <small>智能尺寸会按海报数量自动计算</small></strong>
          <div className="share-format-control">
            {(["adaptive-landscape", "adaptive-portrait", "landscape-4-3", "landscape-16-9", "portrait-3-4", "portrait-9-16", "square", "long"] as ShareFormat[]).map((item) => (
              <button className={format === item ? "is-active" : ""} key={item} type="button" onClick={() => setFormat(item)}>
                {formatLabel(item)}
              </button>
            ))}
          </div>
        </section>
        </div>

        <section className="share-control-group">
          <strong>分享布局 <small>五种布局会真实改变内容组织方式</small></strong>
          <div className="share-layout-control">
            {layoutOptions.map((item) => (
              <button className={layout === item.value ? "is-active" : ""} key={item.value} type="button" onClick={() => setLayout(item.value)}>
                {item.icon}<span><b>{item.label}</b><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong><Palette />主题风格</strong>
          <div className="share-palette-control">
            {paletteOptions.map((item) => (
              <button className={palette === item.value ? "is-active" : ""} data-palette={item.value} key={item.value} type="button" onClick={() => setPalette(item.value)}><i /><span>{item.label}</span></button>
            ))}
          </div>
        </section>

        <section className="share-switches">
          <label><input type="checkbox" checked={showDetails} onChange={(event) => setShowDetails(event.target.checked)} /><span><b>海报信息</b><small>在海报底部叠加日期和标题。</small></span></label>
          <label><input type="checkbox" checked={showBrand} onChange={(event) => setShowBrand(event.target.checked)} /><span><b>品牌标识</b><small>显示现场记 Logo 与 GitHub 项目。</small></span></label>
          <label><input type="checkbox" checked={showStats} onChange={(event) => setShowStats(event.target.checked)} /><span><b>档案统计</b><small>显示城市数和已看场次。</small></span></label>
        </section>

        {error && <p className="share-export-error">{error}</p>}
        <button className="share-export-button" type="button" disabled={saving || preparing || !selectedRecords.length} onClick={() => void savePng()}>
          <Download />{preparing ? "正在准备海报…" : saving ? "正在生成…" : saved ? "已保存到下载目录" : `保存 ${selectedRecords.length} 项档案的 PNG`}
        </button>
      </aside>

      <main ref={previewAreaRef} className={`share-preview-area ${format === "long" ? "is-long" : "is-fixed"}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="share-preview-toolbar" aria-label="预览缩放">
          <button type="button" className={manualScale === null ? "is-active" : ""} onClick={() => setManualScale(null)}><Maximize2 />适应窗口</button>
          <button type="button" aria-label="缩小预览" onClick={() => nudgeScale(-0.08)}><Minus /></button>
          <strong>{Math.round(effectiveScale * 100)}%</strong>
          <button type="button" aria-label="放大预览" onClick={() => nudgeScale(0.08)}><Plus /></button>
        </div>
        <div className="share-preview-viewport" style={viewportStyle}>
          <article className={`share-preview share-preview-${format} share-layout-${layout}`} style={previewStyle}>
            <span className="share-preview-aura" aria-hidden="true" />
            <header>
              <div><span>LIVE MEMORY · CONCERT ARCHIVE</span><h1>{headline.trim() || "我的现场档案"}</h1><p>{period} · {selectedRecords.length} 场演出 · {sortMode === "date-desc" ? "最新在前" : "最早在前"}</p></div>
              {showBrand ? <BrandLockup compact inverse={isDarkPalette(palette)} size={44} /> : null}
            </header>
            <SharePreviewLayout records={selectedRecords} layout={layout} spec={spec} showDetails={showDetails} mapSettings={mapSettings} onOpenMapSettings={onOpenMapSettings} />
            <footer>
              {showBrand ? <span className="share-preview-github">GitHub · Qi-i/live-memory</span> : <span />}
              {showStats ? <strong>{cities} 城市 · {watched} 已看</strong> : <strong />}
            </footer>
          </article>
        </div>
      </main>
    </section>
  );
}

function SharePreviewLayout({
  records,
  layout,
  spec,
  showDetails,
  mapSettings,
  onOpenMapSettings,
}: {
  records: EventRecord[];
  layout: ShareLayout;
  spec: CanvasSpec;
  showDetails: boolean;
  mapSettings: MapConfig;
  onOpenMapSettings: () => void;
}) {
  const area = contentArea(spec);
  if (!records.length) return <div className="share-preview-empty">请选择至少一张海报</div>;

  if (layout === "tickets") {
    const slots = buildTicketSlots(records, area, spec);
    return (
      <div className="share-layout-canvas share-layout-canvas-tickets share-ticket-grid" style={rectStyle(area)}>
        {slots.map((slot) => <ShareTicketCard key={slot.record.id} slot={slot} origin={area} />)}
      </div>
    );
  }

  if (layout === "timeline") {
    const bands = buildTimelineBands(records, area, spec);
    return (
      <div className="share-layout-canvas" style={rectStyle(area)}>
        {bands.map((band) => (
          <section className="share-timeline-band" key={band.label} style={localRectStyle(band.rect, area)}>
            <header><b>{band.label}</b><span>{band.count} 场</span></header>
            {band.slots.map((slot) => <PosterFigure key={slot.record.id} slot={slot} origin={band.rect} showDetails={showDetails} />)}
          </section>
        ))}
      </div>
    );
  }

  if (layout === "cities") {
    const model = buildCityModel(records, area, spec);
    return (
      <div className="share-layout-canvas share-layout-canvas-cities" style={rectStyle(area)}>
        <ShareAmapMap records={records} mapSettings={mapSettings} rect={model.mapRect} origin={area} onOpenMapSettings={onOpenMapSettings} />
        <section className="share-city-poster-field" style={localRectStyle(model.listRect, area)}>
          <header className="share-city-summary">
            <strong>城市现场</strong>
            <div>{model.chips.map((chip) => <span key={chip.label}><b>{chip.label}</b><small>{chip.count}</small></span>)}</div>
          </header>
          <div className="share-city-poster-grid" style={localRectStyle(model.posterRect, model.listRect)}>
            {model.slots.map((slot) => <PosterFigure key={slot.record.id} slot={slot} origin={model.posterRect} showDetails={showDetails} />)}
          </div>
        </section>
      </div>
    );
  }

  const slots = layout === "magazine" ? buildMagazineSlots(records, area, spec) : buildWallFillSlots(records, area, spec);
  return (
    <div className={`share-layout-canvas share-layout-canvas-${layout}`} style={rectStyle(area)}>
      {slots.map((slot) => <PosterFigure key={slot.record.id} slot={slot} origin={area} showDetails={showDetails} />)}
    </div>
  );
}


function buildTicketSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
  if (!records.length) return [];
  const scale = spec.width / 1600;
  const gap = clamp(14 * scale, 10, 24);
  const targetAspect = isLandscapeFormat(spec.format) ? 2.05 : 1.72;
  const rects = buildBalancedRowRects(
    records.length,
    area,
    gap,
    targetAspect,
    isLandscapeFormat(spec.format) ? Math.min(records.length, 7) : Math.min(records.length, 12),
    138 * scale,
    1.55,
  );
  return records.map((record, index) => ({ record, rect: rects[index] }));
}

function ShareTicketCard({ slot, origin }: { slot: PosterSlot; origin: Rect }) {
  const media = primaryMedia(slot.record);
  const src = useCachedMediaSrc(media);
  const ticketPad = clamp(slot.rect.height * 0.065, 10, 22);
  const posterHeight = Math.max(1, slot.rect.height - ticketPad * 2);
  const posterWidth = Math.min(slot.rect.width * 0.46, posterHeight * recordPosterRatio(slot.record));
  const style = {
    ...localRectStyle(slot.rect, origin),
    "--ticket-a": slot.record.colors[0] || "#172229",
    "--ticket-b": slot.record.colors[1] || "#47645d",
    "--ticket-poster-width": `${Math.max(64, posterWidth)}px`,
    "--ticket-pad": `${ticketPad}px`,
    "--ticket-title-size": `${clamp(slot.rect.height * 0.105, 18, 34)}px`,
    "--ticket-artist-size": `${clamp(slot.rect.height * 0.06, 12, 20)}px`,
    "--ticket-meta-size": `${clamp(slot.rect.height * 0.052, 11, 18)}px`,
  } as CSSProperties;
  return (
    <article className="share-ticket-card" style={style}>
      <span className="share-ticket-backdrop" aria-hidden="true">{src ? <img src={src} alt="" decoding="async" /> : null}</span>
      <span className="share-ticket-tint" aria-hidden="true" />
      <div className="share-ticket-poster"><SharePoster record={slot.record} /></div>
      <section>
        <span>{slot.record.date} · {slot.record.city || categoryLabels[slot.record.category]}</span>
        <h3>{slot.record.title}</h3>
        <p>{slot.record.artists.join(" / ") || "艺人待补"}</p>
        <dl>
          <dt>VENUE</dt><dd>{slot.record.venue || "场馆待补"}</dd>
          <dt>SEAT</dt><dd>{slot.record.seat || "座位待补"}</dd>
          <dt>PRICE</dt><dd>{slot.record.price ? `¥${slot.record.price}` : slot.record.publicPriceRange || "票价待补"}</dd>
        </dl>
      </section>
    </article>
  );
}

function PosterFigure({ slot, origin, showDetails }: { slot: PosterSlot; origin: Rect; showDetails: boolean }) {
  return (
    <figure className={`share-layout-poster is-${slot.emphasis || "normal"}`} style={localRectStyle(slot.rect, origin)}>
      <SharePoster record={slot.record} />
      {showDetails ? <figcaption><span>{slot.record.date} · {slot.record.city || categoryLabels[slot.record.category]}</span><b>{slot.record.title}</b></figcaption> : null}
    </figure>
  );
}

function SharePoster({ record }: { record: EventRecord }) {
  const media = primaryMedia(record);
  const src = useCachedMediaSrc(media);
  const style = {
    "--poster-a": record.colors[0],
    "--poster-b": record.colors[1],
    aspectRatio: String(recordPosterRatio(record)),
  } as CSSProperties;
  if (!src) return <span className="share-poster-frame" style={style}><span className="share-poster-fallback">{record.title.slice(0, 4)}</span></span>;
  return <span className="share-poster-frame" style={style}><img className="share-poster-foreground" src={src} alt={record.title} decoding="async" /></span>;
}

function recordPosterRatio(record: EventRecord) {
  const media = primaryMedia(record);
  if (!media?.width || !media.height) return 0.8;
  return clamp(media.width / media.height, 0.5, 1.55);
}

function contentArea(spec: CanvasSpec): Rect {
  return {
    x: spec.padding,
    y: spec.padding + spec.headerHeight,
    width: spec.width - spec.padding * 2,
    height: spec.height - spec.padding * 2 - spec.headerHeight - spec.footerHeight,
  };
}

function rectStyle(rect: Rect): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

function localRectStyle(rect: Rect, origin: Rect): CSSProperties {
  return { left: rect.x - origin.x, top: rect.y - origin.y, width: rect.width, height: rect.height };
}

function buildBalancedRowRects(
  itemCount: number,
  area: Rect,
  gap: number,
  targetAspect: number,
  maxRows: number,
  minHeight = 0,
  minCardAspect = 1.4,
): Rect[] {
  if (!itemCount) return [];
  let bestRows = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let rows = 1; rows <= Math.min(itemCount, maxRows); rows += 1) {
    const rowHeight = (area.height - gap * Math.max(0, rows - 1)) / rows;
    if (rowHeight <= 0) continue;
    const groups = partitionBalanced(itemCount, rows);
    let aspectPenalty = 0;
    let imbalancePenalty = 0;
    for (const [start, end] of groups) {
      const count = Math.max(1, end - start);
      const cardWidth = (area.width - gap * Math.max(0, count - 1)) / count;
      const cardAspect = cardWidth / Math.max(1, rowHeight);
      aspectPenalty += Math.abs(Math.log(Math.max(0.01, cardAspect / targetAspect)));
      if (cardAspect < minCardAspect) aspectPenalty += (minCardAspect - cardAspect) * 2.4;
      imbalancePenalty += Math.abs(count - itemCount / rows) * 0.04;
    }
    const heightPenalty = rowHeight < minHeight ? (minHeight - rowHeight) / Math.max(1, minHeight) * 1.8 : 0;
    const score = aspectPenalty / groups.length + imbalancePenalty + heightPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }

  const groups = partitionBalanced(itemCount, bestRows);
  const rowHeight = (area.height - gap * Math.max(0, bestRows - 1)) / bestRows;
  const rects: Rect[] = [];
  groups.forEach(([start, end], row) => {
    const count = Math.max(1, end - start);
    const cardWidth = (area.width - gap * Math.max(0, count - 1)) / count;
    for (let column = 0; column < count; column += 1) {
      rects.push({
        x: area.x + column * (cardWidth + gap),
        y: area.y + row * (rowHeight + gap),
        width: cardWidth,
        height: rowHeight,
      });
    }
  });
  return rects;
}

function partitionBalanced(itemCount: number, groupCount: number): Array<[number, number]> {
  const base = Math.floor(itemCount / groupCount);
  const remainder = itemCount % groupCount;
  const groups: Array<[number, number]> = [];
  let start = 0;
  for (let index = 0; index < groupCount; index += 1) {
    const count = base + (index < remainder ? 1 : 0);
    groups.push([start, start + count]);
    start += count;
  }
  return groups;
}

function buildFilledGridRects(
  itemCount: number,
  area: Rect,
  gap: number,
  targetAspect: number,
  maxColumns: number,
  minHeight = 0,
): Rect[] {
  if (!itemCount) return [];
  let bestColumns = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= Math.min(itemCount, maxColumns); columns += 1) {
    const rows = Math.ceil(itemCount / columns);
    const width = (area.width - gap * Math.max(0, columns - 1)) / columns;
    const height = (area.height - gap * Math.max(0, rows - 1)) / rows;
    if (width <= 0 || height <= 0) continue;
    const aspectPenalty = Math.abs(Math.log(Math.max(0.01, width / height / targetAspect)));
    const emptyPenalty = (rows * columns - itemCount) / Math.max(1, itemCount) * 0.09;
    const heightPenalty = height < minHeight ? (minHeight - height) / Math.max(1, minHeight) * 1.8 : 0;
    const score = aspectPenalty + emptyPenalty + heightPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }

  const rows = Math.ceil(itemCount / bestColumns);
  const rowHeight = (area.height - gap * Math.max(0, rows - 1)) / rows;
  const rects: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    const start = row * bestColumns;
    const count = Math.min(bestColumns, itemCount - start);
    const cellWidth = (area.width - gap * Math.max(0, count - 1)) / count;
    for (let column = 0; column < count; column += 1) {
      rects.push({
        x: area.x + column * (cellWidth + gap),
        y: area.y + row * (rowHeight + gap),
        width: cellWidth,
        height: rowHeight,
      });
    }
  }
  return rects;
}

function partitionByAspect(records: EventRecord[], rowCount: number): Array<[number, number]> {
  if (rowCount <= 1) return [[0, records.length]];
  const ratios = records.map(recordPosterRatio);
  const groups: Array<[number, number]> = [];
  let start = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const remainingRows = rowCount - row;
    const maxEnd = records.length - (remainingRows - 1);
    if (row === rowCount - 1) {
      groups.push([start, records.length]);
      break;
    }
    const remainingRatio = ratios.slice(start).reduce((sum, ratio) => sum + ratio, 0);
    const target = remainingRatio / remainingRows;
    let end = start + 1;
    let sum = ratios[start] || 0.8;
    while (end < maxEnd) {
      const next = ratios[end];
      if (Math.abs(sum - target) <= Math.abs(sum + next - target)) break;
      sum += next;
      end += 1;
    }
    groups.push([start, end]);
    start = end;
  }
  return groups;
}

function buildWallFillSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
  if (!records.length || area.width <= 0 || area.height <= 0) return [];
  const scale = spec.width / 1600;
  const gap = clamp(11 * scale, 7, 18);
  const maxRows = Math.min(records.length, spec.format === "long" ? 14 : isLandscapeFormat(spec.format) ? 9 : 13);
  let bestRows = 1;
  let bestGroups: Array<[number, number]> = [[0, records.length]];
  let bestScore = Number.POSITIVE_INFINITY;

  for (let rows = 1; rows <= maxRows; rows += 1) {
    const rowHeight = (area.height - gap * Math.max(0, rows - 1)) / rows;
    if (rowHeight <= 38) continue;
    const groups = partitionByAspect(records, rows);
    let distortion = 0;
    let narrowPenalty = 0;
    let extremePenalty = 0;
    for (const [start, end] of groups) {
      const ratioSum = records.slice(start, end).reduce((sum, record) => sum + recordPosterRatio(record), 0);
      const availableWidth = area.width - gap * Math.max(0, end - start - 1);
      const naturalWidth = ratioSum * rowHeight;
      const rowScale = availableWidth / Math.max(1, naturalWidth);
      distortion += Math.abs(Math.log(Math.max(0.01, rowScale)));
      if (rowScale < 0.72 || rowScale > 1.38) extremePenalty += Math.abs(1 - rowScale) * 2.2;
      const smallest = Math.min(...records.slice(start, end).map((record) => recordPosterRatio(record) * rowHeight * rowScale));
      if (smallest < 72 * scale) narrowPenalty += (72 * scale - smallest) / Math.max(1, 72 * scale);
    }
    const score = distortion / groups.length + extremePenalty + narrowPenalty * 0.45;
    if (score < bestScore) {
      bestScore = score;
      bestRows = rows;
      bestGroups = groups;
    }
  }

  const rowHeight = (area.height - gap * Math.max(0, bestRows - 1)) / bestRows;
  const slots: PosterSlot[] = [];
  let y = area.y;
  bestGroups.forEach(([start, end]) => {
    const availableWidth = area.width - gap * Math.max(0, end - start - 1);
    const ratioSum = records.slice(start, end).reduce((sum, record) => sum + recordPosterRatio(record), 0);
    const rowScale = availableWidth / Math.max(1, ratioSum * rowHeight);
    let x = area.x;
    for (let index = start; index < end; index += 1) {
      const isLast = index === end - 1;
      const width = isLast
        ? area.x + area.width - x
        : recordPosterRatio(records[index]) * rowHeight * rowScale;
      slots.push({ record: records[index], rect: { x, y, width: Math.max(1, width), height: rowHeight } });
      x += width + gap;
    }
    y += rowHeight + gap;
  });
  return slots;
}

function magazineArtistKey(record: EventRecord) {
  return record.artists.map((artist) => artist.trim().toLowerCase()).find(Boolean) || `__record__${record.id}`;
}

function orderMagazineRecords(records: EventRecord[]) {
  const latest = records.slice().sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const latestByArtist = new Map<string, EventRecord>();
  for (const record of latest) {
    const key = magazineArtistKey(record);
    if (!latestByArtist.has(key)) latestByArtist.set(key, record);
  }
  const featured = Array.from(latestByArtist.values());
  const featuredIds = new Set(featured.map((record) => record.id));
  return {
    ordered: [...featured, ...records.filter((record) => !featuredIds.has(record.id))],
    featuredIds,
  };
}

function buildMagazineSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
  if (!records.length) return [];
  const gap = clamp(12 * (spec.width / 1600), 8, 20);
  const { ordered, featuredIds } = orderMagazineRecords(records);
  const featuredCount = ordered.filter((record) => featuredIds.has(record.id)).length;
  const weights = ordered.map((record, index) => {
    if (!featuredIds.has(record.id)) return 0.72;
    if (index === 0) return 2.7;
    if (index < 3) return 2.15;
    if (index < 6) return 1.75;
    return 1.38;
  });
  const rects = buildWeightedMosaic(weights, area, gap);
  const assignedRects = assignMagazineRectsByAspect(ordered, rects, featuredIds);
  return ordered.map((record, index) => ({
    record,
    rect: assignedRects[index],
    emphasis: index === 0
      ? "hero"
      : index < Math.min(featuredCount, 6)
        ? "feature"
        : "normal",
  }));
}

function assignMagazineRectsByAspect(records: EventRecord[], rects: Rect[], featuredIds: Set<string>) {
  const byArea = rects
    .map((rect, index) => ({ rect, index, area: rect.width * rect.height }))
    .sort((a, b) => b.area - a.area);
  const featuredRecords = records.filter((record) => featuredIds.has(record.id));
  const regularRecords = records.filter((record) => !featuredIds.has(record.id));
  const featuredPool = byArea.slice(0, featuredRecords.length);
  const regularPool = byArea.slice(featuredRecords.length);
  const assignments = new Map<string, Rect>();

  function assignGroup(group: EventRecord[], pool: typeof byArea, feature: boolean) {
    const remaining = pool.slice();
    for (let recordIndex = 0; recordIndex < group.length; recordIndex += 1) {
      const record = group[recordIndex];
      const posterRatio = recordPosterRatio(record);
      const maxArea = Math.max(1, ...remaining.map((item) => item.area));
      let bestIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      remaining.forEach((item, index) => {
        const rectRatio = item.rect.width / Math.max(1, item.rect.height);
        const ratioPenalty = Math.abs(Math.log(Math.max(0.01, rectRatio / posterRatio)));
        const areaPenalty = 1 - item.area / maxArea;
        const sizeWeight = feature ? (recordIndex === 0 ? 0.9 : 0.24) : 0.04;
        const score = ratioPenalty + areaPenalty * sizeWeight;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      const [chosen] = remaining.splice(bestIndex, 1);
      if (chosen) assignments.set(record.id, chosen.rect);
    }
  }

  assignGroup(featuredRecords, featuredPool, true);
  assignGroup(regularRecords, regularPool, false);
  return records.map((record, index) => assignments.get(record.id) || rects[index]);
}

function buildWeightedMosaic(weights: number[], area: Rect, gap: number): Rect[] {
  const output = new Array<Rect>(weights.length);
  const entries = weights.map((weight, index) => ({ weight: Math.max(0.1, weight), index }));

  function split(items: typeof entries, rect: Rect, depth: number) {
    if (!items.length) return;
    if (items.length === 1) {
      output[items[0].index] = rect;
      return;
    }
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let running = 0;
    let splitAt = 1;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 1; index < items.length; index += 1) {
      running += items[index - 1].weight;
      const delta = Math.abs(total / 2 - running);
      if (delta < best) {
        best = delta;
        splitAt = index;
      }
    }
    const first = items.slice(0, splitAt);
    const second = items.slice(splitAt);
    const firstWeight = first.reduce((sum, item) => sum + item.weight, 0);
    const horizontal = rect.width >= rect.height * (depth % 2 ? 0.9 : 1.08);
    if (horizontal) {
      const usable = Math.max(1, rect.width - gap);
      const firstWidth = usable * firstWeight / total;
      split(first, { x: rect.x, y: rect.y, width: firstWidth, height: rect.height }, depth + 1);
      split(second, { x: rect.x + firstWidth + gap, y: rect.y, width: usable - firstWidth, height: rect.height }, depth + 1);
    } else {
      const usable = Math.max(1, rect.height - gap);
      const firstHeight = usable * firstWeight / total;
      split(first, { x: rect.x, y: rect.y, width: rect.width, height: firstHeight }, depth + 1);
      split(second, { x: rect.x, y: rect.y + firstHeight + gap, width: rect.width, height: usable - firstHeight }, depth + 1);
    }
  }

  split(entries, area, 0);
  return output;
}

function buildTimelineBands(records: EventRecord[], area: Rect, spec: CanvasSpec): TimelineBand[] {
  const groups = groupByYear(records);
  if (!groups.length) return [];
  const scale = spec.width / 1600;
  const gap = clamp(14 * scale, 9, 22);
  const rects = buildFilledGridRects(
    groups.length,
    area,
    gap,
    spec.format === "long" ? 0.86 : isLandscapeFormat(spec.format) ? 2.15 : 1.05,
    spec.format === "long" ? 1 : isLandscapeFormat(spec.format) ? 3 : 2,
    240 * scale,
  );
  return groups.map((group, index) => {
    const rect = rects[index];
    const inset = clamp(14 * scale, 10, 24);
    const headerHeight = clamp(rect.height * 0.2, 58 * scale, 110 * scale);
    const posterArea = {
      x: rect.x + inset,
      y: rect.y + headerHeight,
      width: rect.width - inset * 2,
      height: Math.max(1, rect.height - headerHeight - inset),
    };
    return {
      label: group.label,
      count: group.records.length,
      rect,
      headerHeight,
      slots: buildWallFillSlots(group.records, posterArea, spec),
    };
  });
}

function buildCityModel(records: EventRecord[], area: Rect, spec: CanvasSpec) {
  const scale = spec.width / 1600;
  const gap = clamp(18 * scale, 12, 28);
  const mapRatio = isLandscapeFormat(spec.format) ? 0.43 : 0.39;
  const mapWidth = area.width * mapRatio;
  const mapRect = { x: area.x, y: area.y, width: mapWidth, height: area.height };
  const listRect = {
    x: area.x + mapWidth + gap,
    y: area.y,
    width: area.width - mapWidth - gap,
    height: area.height,
  };
  const chipHeight = clamp(listRect.height * 0.13, 78 * scale, 150 * scale);
  const posterRect = {
    x: listRect.x,
    y: listRect.y + chipHeight,
    width: listRect.width,
    height: Math.max(1, listRect.height - chipHeight),
  };
  const chips: CityChip[] = groupByCity(records).map((group) => ({ label: group.label, count: group.records.length }));
  return {
    mapRect,
    listRect,
    posterRect,
    chips,
    slots: buildWallFillSlots(records, posterRect, spec),
  };
}

function ShareAmapMap({
  records,
  mapSettings,
  rect,
  origin,
  onOpenMapSettings,
}: {
  records: EventRecord[];
  mapSettings: MapConfig;
  rect: Rect;
  origin: Rect;
  onOpenMapSettings: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [resolvedCount, setResolvedCount] = useState(0);

  useEffect(() => {
    if (!mapSettings.amapKey.trim()) {
      setState("idle");
      setResolvedCount(0);
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let map: ReturnType<typeof createAmapInstance> | null = null;
    setState("loading");

    void loadAmap({ key: mapSettings.amapKey, securityCode: mapSettings.amapSecurityCode })
      .then(async (AMap) => {
        if (disposed || !hostRef.current) return;
        map = createAmapInstance(AMap, hostRef.current);
        const points = await resolveShareMapPoints(AMap, records);
        if (disposed || !map) return;
        const markers = points.map((point) => new AMap.Marker({ position: point.position, title: point.title }));
        if (AMap.Polyline && points.length > 1) {
          const route = new AMap.Polyline({
            path: points.slice().sort((a, b) => a.date.localeCompare(b.date)).map((point) => point.position),
            strokeColor: "#0b8f78",
            strokeOpacity: 0.78,
            strokeWeight: 5,
            lineJoin: "round",
            lineCap: "round",
          });
          map.add?.(route);
        }
        if (markers.length) map.add?.(markers);
        setResolvedCount(points.length);
        setState(points.length ? "ready" : "empty");
      })
      .catch(() => {
        if (!disposed) setState("error");
      });

    return () => {
      disposed = true;
      map?.destroy();
    };
  }, [mapSettings.amapKey, mapSettings.amapSecurityCode, records]);

  const configured = Boolean(mapSettings.amapKey.trim());
  return (
    <section className="share-amap-panel" style={localRectStyle(rect, origin)}>
      <div className="share-amap-map" ref={hostRef} aria-label="高德地图城市足迹" />
      <header><b>全国城市足迹</b><span>{resolvedCount ? `${resolvedCount} 个城市` : "AMap · 固定全国视野"}</span></header>
      {!configured ? <div className="share-amap-state"><b>需要高德地图</b><span>这里直接复用个人内容中已保存的高德 Web JS API Key。</span><button type="button" onClick={onOpenMapSettings}>去配置高德地图</button></div> : null}
      {configured && state === "loading" ? <div className="share-amap-state"><b>正在匹配城市…</b><span>地图保持固定全国视野，仅由高德匹配演出城市位置。</span></div> : null}
      {configured && state === "empty" ? <div className="share-amap-state"><b>暂无可定位城市</b><span>请先为演出记录补充城市名称。</span></div> : null}
      {configured && state === "error" ? <div className="share-amap-state"><b>高德地图加载失败</b><span>请检查 Key、安全密钥与域名白名单。</span></div> : null}
    </section>
  );
}

const SHARE_CHINA_MAP_CENTER: [number, number] = [104.3, 35.85];
const SHARE_CHINA_BOUNDS = {
  west: 73.4,
  east: 135.2,
  south: 18.1,
  north: 53.6,
} as const;

function mercatorY(latitude: number) {
  const clamped = clamp(latitude, -85.05112878, 85.05112878);
  const radians = clamped * Math.PI / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function chinaViewportZoom(host: HTMLElement) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  const padding = Math.min(52, Math.max(20, Math.min(width, height) * 0.06));
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const xSpan = (SHARE_CHINA_BOUNDS.east - SHARE_CHINA_BOUNDS.west) / 360;
  const ySpan = Math.abs(mercatorY(SHARE_CHINA_BOUNDS.north) - mercatorY(SHARE_CHINA_BOUNDS.south));
  const zoomX = Math.log2(usableWidth / (256 * xSpan));
  const zoomY = Math.log2(usableHeight / (256 * ySpan));
  return clamp(Math.min(zoomX, zoomY), 2.4, 4.8);
}

function createAmapInstance(AMap: AMapNamespace, host: HTMLElement) {
  return new AMap.Map(host, {
    resizeEnable: true,
    viewMode: "2D",
    center: SHARE_CHINA_MAP_CENTER,
    zoom: chinaViewportZoom(host),
    mapStyle: "amap://styles/whitesmoke",
    zoomEnable: false,
    dragEnable: false,
    scrollWheel: false,
    doubleClickZoom: false,
    keyboardEnable: false,
    touchZoom: false,
    rotateEnable: false,
    pitchEnable: false,
  });
}

async function resolveShareMapPoints(AMap: AMapNamespace, records: EventRecord[]): Promise<ShareMapPoint[]> {
  const cities = new Map<string, { label: string; date: string }>();
  for (const record of records) {
    const label = record.city.trim();
    if (!label) continue;
    const key = label.replace(/市$/u, "").trim().toLowerCase();
    const current = cities.get(key);
    if (!current || record.date.localeCompare(current.date) < 0) cities.set(key, { label, date: record.date });
  }
  if (!cities.size) return [];

  if (!AMap.Geocoder && AMap.plugin) {
    await new Promise<void>((resolve) => AMap.plugin?.("AMap.Geocoder", resolve));
  }
  if (!AMap.Geocoder) return [];
  const geocoder = new AMap.Geocoder({ city: "全国" });

  const points: ShareMapPoint[] = [];
  for (const city of Array.from(cities.values()).slice(0, 40)) {
    const position = await geocodeAmapPlace(geocoder, city.label);
    if (position) points.push({ position, title: city.label, date: city.date });
  }
  return points;
}

function geocodeAmapPlace(
  geocoder: InstanceType<NonNullable<AMapNamespace["Geocoder"]>>,
  query: string,
): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    geocoder.getLocation(query, (status, result) => {
      if (status !== "complete" || result.info !== "OK") {
        resolve(null);
        return;
      }
      resolve(amapLocationTuple(result.geocodes?.[0]?.location));
    });
  });
}

function amapLocationTuple(location?: AMapLngLatLike | [number, number]): [number, number] | null {
  if (!location) return null;
  if (Array.isArray(location)) {
    const lng = Number(location[0]);
    const lat = Number(location[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  const lng = Number(typeof location.getLng === "function" ? location.getLng() : location.lng);
  const lat = Number(typeof location.getLat === "function" ? location.getLat() : location.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function captureShareAmapSurface() {
  const host = document.querySelector<HTMLElement>(".share-amap-map");
  if (!host) return null;
  const hostRect = host.getBoundingClientRect();
  const layers = Array.from(host.querySelectorAll<HTMLCanvasElement>("canvas")).filter((canvas) => canvas.width > 0 && canvas.height > 0);
  if (!layers.length || hostRect.width <= 0 || hostRect.height <= 0) return null;
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const snapshot = document.createElement("canvas");
  snapshot.width = Math.max(1, Math.round(hostRect.width * density));
  snapshot.height = Math.max(1, Math.round(hostRect.height * density));
  const context = snapshot.getContext("2d");
  if (!context) return null;
  try {
    for (const layer of layers) {
      const rect = layer.getBoundingClientRect();
      context.drawImage(
        layer,
        (rect.left - hostRect.left) * density,
        (rect.top - hostRect.top) * density,
        rect.width * density,
        rect.height * density,
      );
    }
    const markerElements = Array.from(host.querySelectorAll<HTMLElement>(".amap-marker"));
    for (const marker of markerElements) {
      const rect = marker.getBoundingClientRect();
      const x = (rect.left + rect.width / 2 - hostRect.left) * density;
      const y = (rect.top + rect.height / 2 - hostRect.top) * density;
      context.beginPath();
      context.arc(x, y, 7 * density, 0, Math.PI * 2);
      context.fillStyle = "#0b8f78";
      context.fill();
      context.lineWidth = 3 * density;
      context.strokeStyle = "#ffffff";
      context.stroke();
    }
    context.getImageData(0, 0, 1, 1);
    return snapshot;
  } catch {
    return null;
  }
}

function groupByYear(records: EventRecord[]) {
  const groups = new Map<string, EventRecord[]>();
  records.forEach((record) => {
    const key = record.date.slice(0, 4) || "未定";
    groups.set(key, [...(groups.get(key) || []), record]);
  });
  return Array.from(groups, ([label, groupedRecords]) => ({ label, records: groupedRecords }));
}

function groupByCity(records: EventRecord[]) {
  const groups = new Map<string, EventRecord[]>();
  records.forEach((record) => {
    const key = record.city || "城市待补";
    groups.set(key, [...(groups.get(key) || []), record]);
  });
  return Array.from(groups, ([label, groupedRecords]) => ({ label, records: groupedRecords }));
}

function formatPeriod(records: EventRecord[]) {
  if (!records.length) return "尚未选择";
  const dates = records.map((record) => record.date).filter(Boolean).sort();
  const first = dates[0];
  const last = dates[dates.length - 1] || first;
  if (first.slice(0, 4) === last.slice(0, 4)) return first.slice(0, 4);
  return `${first.slice(0, 4)}—${last.slice(0, 4)}`;
}


function formatLabel(format: ShareFormat) {
  if (format === "adaptive-landscape") return "智能横版";
  if (format === "adaptive-portrait") return "智能竖版";
  if (format === "landscape-4-3") return "横版 4:3";
  if (format === "landscape-16-9") return "横版 16:9";
  if (format === "portrait-3-4") return "竖版 3:4";
  if (format === "portrait-9-16") return "竖版 9:16";
  if (format === "square") return "方形 1:1";
  return "手机长图";
}

function isAdaptiveFormat(format: ShareFormat) {
  return format === "adaptive-landscape" || format === "adaptive-portrait";
}

function isLandscapeFormat(format: ShareFormat) {
  return format === "landscape-4-3" || format === "landscape-16-9" || format === "adaptive-landscape";
}

function isDarkPalette(palette: SharePalette) {
  return palette === "midnight" || palette === "graphite" || palette === "forest" || palette === "plum";
}

function contentResolutionScale(count: number, layout: ShareLayout) {
  const target = layout === "tickets" ? 14 : layout === "timeline" || layout === "cities" ? 18 : layout === "magazine" ? 22 : 26;
  return clamp(Math.sqrt(Math.max(1, count) / target), 1, 1.5);
}

function scaledSpec(
  format: ShareFormat,
  width: number,
  height: number,
  padding: number,
  headerHeight: number,
  footerHeight: number,
  scale: number,
): CanvasSpec {
  return {
    format,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    padding: Math.round(padding * scale),
    headerHeight: Math.round(headerHeight * scale),
    footerHeight: Math.round(footerHeight * scale),
  };
}

function getAdaptiveCanvasSpec(format: "adaptive-landscape" | "adaptive-portrait", records: EventRecord[], layout: ShareLayout): CanvasSpec {
  const landscape = format === "adaptive-landscape";
  const scale = contentResolutionScale(records.length, layout);
  const baseHeight = landscape
    ? layout === "wall" || layout === "magazine" ? 1000 : 1080
    : layout === "wall" || layout === "magazine" ? 1800 : 1900;
  return scaledSpec(
    format,
    landscape ? 1600 : 1200,
    baseHeight,
    landscape ? 48 : 44,
    landscape ? 118 : 132,
    58,
    scale,
  );
}

function getCanvasSpec(format: ShareFormat, count: number, layout: ShareLayout, records: EventRecord[]): CanvasSpec {
  if (format === "adaptive-landscape" || format === "adaptive-portrait") return getAdaptiveCanvasSpec(format, records, layout);

  if (format === "long") {
    const width = 1200;
    const padding = 54;
    const headerHeight = 156;
    const footerHeight = 68;
    const groupCount = layout === "timeline" ? groupByYear(records).length : 0;
    const contentHeight = layout === "timeline"
      ? Math.max(1500, count * 135 + groupCount * 95)
      : layout === "tickets"
        ? Math.max(1500, Math.ceil(Math.max(1, count) / 3) * 270)
        : layout === "cities"
          ? Math.max(1600, Math.ceil(Math.max(1, count) / 4) * 255)
          : layout === "magazine"
            ? Math.max(1500, Math.ceil(Math.max(1, count) / 4) * 285)
            : Math.max(1500, Math.ceil(Math.max(1, count) / 4) * 250);
    return { width, height: padding * 2 + headerHeight + footerHeight + contentHeight, padding, headerHeight, footerHeight, format };
  }

  const fixed: Record<Exclude<ShareFormat, "adaptive-landscape" | "adaptive-portrait" | "long">, [number, number]> = {
    "landscape-4-3": [1600, 1200],
    "landscape-16-9": [1600, 900],
    "portrait-3-4": [1200, 1600],
    "portrait-9-16": [1200, 2133],
    square: [1200, 1200],
  };
  const [baseWidth, baseHeight] = fixed[format];
  const scale = contentResolutionScale(count, layout);
  const landscape = isLandscapeFormat(format);
  return scaledSpec(format, baseWidth, baseHeight, landscape ? 56 : 52, landscape ? 132 : 150, 66, scale);
}

async function exportSharePng(options: ExportOptions) {
  const spec = getCanvasSpec(options.format, options.records.length, options.layout, options.records);
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  await document.fonts?.ready;

  const palette = palettes[options.palette];
  drawBackground(context, spec.width, spec.height, palette);
  drawShareHeader(context, spec, options, palette);
  const area = contentArea(spec);

  if (options.layout === "timeline") await drawTimelineCanvas(context, buildTimelineBands(options.records, area, spec), options, palette);
  else if (options.layout === "cities") await drawCitiesCanvas(context, buildCityModel(options.records, area, spec), options, palette);
  else if (options.layout === "tickets") {
    for (const slot of buildTicketSlots(options.records, area, spec)) await drawTicket(context, slot.record, slot.rect, palette);
  } else {
    const slots = options.layout === "magazine" ? buildMagazineSlots(options.records, area, spec) : buildWallFillSlots(options.records, area, spec);
    for (const slot of slots) await drawPoster(context, slot.record, slot.rect, palette, options.showDetails, slot.emphasis);
  }

  drawShareFooter(context, spec, options, palette);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
  if (!blob) throw new Error("PNG export failed");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `现场记-${options.records.length}场-${options.layout}-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function drawTicket(
  context: CanvasRenderingContext2D,
  record: EventRecord,
  slot: Rect,
  palette: PaletteDefinition,
) {
  context.save();
  roundedPath(context, slot.x, slot.y, slot.width, slot.height, Math.max(12, slot.height * 0.06));
  context.clip();
  const image = await loadMediaImage(primaryMedia(record));
  if (image) {
    context.save();
    context.filter = "blur(20px) saturate(1.15)";
    drawCover(context, image, slot.x - 20, slot.y - 20, slot.width + 40, slot.height + 40, record.colors[0] || palette.surface);
    context.restore();
  } else {
    drawFallback(context, record, slot.x, slot.y, slot.width, slot.height);
  }
  const tint = context.createLinearGradient(slot.x, slot.y, slot.x + slot.width, slot.y + slot.height);
  tint.addColorStop(0, `${record.colors[0] || "#172229"}dc`);
  tint.addColorStop(1, `${record.colors[1] || "#47645d"}b8`);
  context.fillStyle = tint;
  context.fillRect(slot.x, slot.y, slot.width, slot.height);

  const inset = clamp(slot.height * 0.065, 12, 24);
  const posterHeight = Math.max(1, slot.height - inset * 2);
  const posterWidth = Math.min(slot.width * 0.46, posterHeight * recordPosterRatio(record));
  const posterRect = { x: slot.x + inset, y: slot.y + inset, width: posterWidth, height: posterHeight };
  if (image) drawCover(context, image, posterRect.x, posterRect.y, posterRect.width, posterRect.height, palette.surface);
  else drawFallback(context, record, posterRect.x, posterRect.y, posterRect.width, posterRect.height);
  roundedPath(context, posterRect.x, posterRect.y, posterRect.width, posterRect.height, 10);
  context.strokeStyle = "rgba(255,255,255,.42)";
  context.lineWidth = 1.5;
  context.stroke();

  const copyX = posterRect.x + posterRect.width + inset;
  const copyWidth = slot.x + slot.width - copyX - inset;
  context.fillStyle = "rgba(255,255,255,.86)";
  roundedPath(context, copyX - inset * 0.5, slot.y + inset, copyWidth + inset * 0.5, slot.height - inset * 2, 12);
  context.fill();
  const titleSize = clamp(slot.height * 0.105, 18, 36);
  const artistSize = clamp(slot.height * 0.06, 12, 21);
  const metaSize = clamp(slot.height * 0.052, 11, 18);
  context.fillStyle = "#15201f";
  context.font = `900 ${titleSize}px system-ui, sans-serif`;
  const titleLines = wrapTextLines(context, record.title, copyWidth - 8, 2);
  titleLines.forEach((line, index) => context.fillText(line, copyX, slot.y + slot.height * (0.29 + index * 0.115)));
  context.fillStyle = "rgba(21,32,31,.66)";
  context.font = `800 ${artistSize}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.artists.join(" / ") || "艺人待补", copyWidth - 8), copyX, slot.y + slot.height * 0.55);
  context.font = `750 ${metaSize}px system-ui, sans-serif`;
  context.fillText(trimText(context, `${record.date} · ${record.city || "城市待补"} · ${record.venue || "场馆待补"}`, copyWidth - 8), copyX, slot.y + slot.height * 0.70);
  context.fillText(trimText(context, `${record.seat || "座位待补"} · ${record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"}`, copyWidth - 8), copyX, slot.y + slot.height * 0.84);
  context.restore();

  roundedPath(context, slot.x, slot.y, slot.width, slot.height, Math.max(12, slot.height * 0.06));
  context.strokeStyle = palette.border;
  context.lineWidth = 1.5;
  context.stroke();
}

async function drawTimelineCanvas(context: CanvasRenderingContext2D, bands: TimelineBand[], options: ExportOptions, palette: PaletteDefinition) {
  for (const band of bands) {
    roundedPath(context, band.rect.x, band.rect.y, band.rect.width, band.rect.height, 18);
    context.fillStyle = alphaSurface(palette.surface, 0.78);
    context.fill();
    context.strokeStyle = palette.border;
    context.stroke();
    const titleSize = clamp(band.headerHeight * 0.42, 28, 58);
    const metaSize = clamp(titleSize * 0.43, 13, 24);
    context.fillStyle = palette.accent;
    context.fillRect(band.rect.x + 18, band.rect.y + 18, 5, Math.max(24, band.headerHeight - 28));
    context.fillStyle = palette.text;
    context.font = `900 ${titleSize}px system-ui, sans-serif`;
    context.fillText(band.label, band.rect.x + 38, band.rect.y + 18 + titleSize);
    context.fillStyle = palette.muted;
    context.font = `800 ${metaSize}px system-ui, sans-serif`;
    context.fillText(`${band.count} 场现场`, band.rect.x + 42 + context.measureText(band.label).width, band.rect.y + 18 + titleSize);
    for (const slot of band.slots) await drawPoster(context, slot.record, slot.rect, palette, options.showDetails);
  }
}


async function drawCitiesCanvas(
  context: CanvasRenderingContext2D,
  model: ReturnType<typeof buildCityModel>,
  options: ExportOptions,
  palette: PaletteDefinition,
) {
  const map = model.mapRect;
  roundedPath(context, map.x, map.y, map.width, map.height, 22);
  context.save();
  context.clip();
  if (options.mapSnapshot) {
    context.drawImage(options.mapSnapshot, map.x, map.y, map.width, map.height);
  } else {
    context.fillStyle = alphaSurface(palette.surface, 0.9);
    context.fillRect(map.x, map.y, map.width, map.height);
    context.fillStyle = palette.text;
    context.font = `900 ${Math.max(24, Math.round(map.width * 0.05))}px system-ui, sans-serif`;
    context.fillText("高德地图 · AMap", map.x + 28, map.y + 56);
    context.fillStyle = palette.muted;
    context.font = `800 ${Math.max(14, Math.round(map.width * 0.025))}px system-ui, sans-serif`;
    context.fillText("在线预览使用真实高德底图", map.x + 28, map.y + 88);
    context.fillText("当前浏览器未提供可安全导出的地图画布", map.x + 28, map.y + 114);
  }
  const shade = context.createLinearGradient(map.x, map.y, map.x, map.y + map.height * 0.3);
  shade.addColorStop(0, "rgba(0,0,0,.46)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = shade;
  context.fillRect(map.x, map.y, map.width, map.height * 0.35);
  context.fillStyle = "#ffffff";
  context.font = `900 ${Math.max(22, Math.round(map.width * 0.045))}px system-ui, sans-serif`;
  context.fillText("全国城市足迹", map.x + 26, map.y + 42);
  context.restore();
  context.strokeStyle = palette.border;
  context.lineWidth = 2;
  roundedPath(context, map.x, map.y, map.width, map.height, 22);
  context.stroke();

  const chipTop = model.listRect.y + 4;
  const chipBottom = model.posterRect.y - 10;
  let chipX = model.listRect.x;
  let chipY = chipTop;
  const lineHeight = Math.max(32, (chipBottom - chipTop) / 2);
  context.font = `850 ${Math.max(13, Math.round(model.listRect.width * 0.018))}px system-ui, sans-serif`;
  for (const chip of model.chips) {
    const label = `${chip.label} · ${chip.count}`;
    const chipWidth = Math.min(model.listRect.width, context.measureText(label).width + 30);
    if (chipX + chipWidth > model.listRect.x + model.listRect.width && chipX > model.listRect.x) {
      chipX = model.listRect.x;
      chipY += lineHeight;
    }
    if (chipY + lineHeight > model.posterRect.y) break;
    roundedPath(context, chipX, chipY, chipWidth, lineHeight - 6, (lineHeight - 6) / 2);
    context.fillStyle = alphaSurface(palette.surface, 0.88);
    context.fill();
    context.fillStyle = palette.text;
    context.fillText(label, chipX + 15, chipY + lineHeight * 0.62);
    chipX += chipWidth + 8;
  }

  for (const slot of model.slots) {
    await drawPoster(context, slot.record, slot.rect, palette, options.showDetails, slot.emphasis);
  }
}

async function drawPoster(
  context: CanvasRenderingContext2D,
  record: EventRecord,
  slot: Rect,
  palette: PaletteDefinition,
  showDetails: boolean,
  emphasis: PosterSlot["emphasis"] = "normal",
) {
  context.save();
  const radius = Math.max(5, Math.min(slot.width, slot.height) * 0.045);
  context.shadowColor = emphasis === "hero" ? "rgba(0,0,0,.3)" : "rgba(0,0,0,.2)";
  context.shadowBlur = emphasis === "hero" ? 28 : 14;
  context.shadowOffsetY = emphasis === "hero" ? 12 : 6;
  roundedPath(context, slot.x, slot.y, slot.width, slot.height, radius);
  context.fillStyle = palette.surface;
  context.fill();
  context.shadowColor = "transparent";
  roundedPath(context, slot.x, slot.y, slot.width, slot.height, radius);
  context.clip();

  const image = await loadMediaImage(primaryMedia(record));
  if (image) drawCover(context, image, slot.x, slot.y, slot.width, slot.height, palette.surface);
  else drawFallback(context, record, slot.x, slot.y, slot.width, slot.height);
  if (showDetails) drawDetails(context, record, slot, palette);
  context.restore();

  context.strokeStyle = palette.border;
  context.lineWidth = emphasis === "hero" ? 3 : 1.5;
  roundedPath(context, slot.x, slot.y, slot.width, slot.height, radius);
  context.stroke();
}

function drawShareHeader(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const x = spec.padding;
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.max(16, Math.round(spec.width * 0.013))}px system-ui, sans-serif`;
  context.fillText("LIVE MEMORY · CONCERT ARCHIVE", x, spec.padding * 0.72);
  context.fillStyle = palette.text;
  context.font = `900 ${Math.round(spec.width * (isLandscapeFormat(options.format) ? 0.037 : 0.049))}px system-ui, sans-serif`;
  context.fillText(trimText(context, options.headline, spec.width - spec.padding * 4.5), x, spec.padding + spec.headerHeight * 0.46);
  context.fillStyle = palette.muted;
  context.font = `700 ${Math.max(14, Math.round(spec.width * 0.012))}px system-ui, sans-serif`;
  context.fillText(`${formatPeriod(options.records)} · ${options.records.length} 场演出 · ${options.sortMode === "date-desc" ? "最新在前" : "最早在前"}`, x, spec.padding + spec.headerHeight * 0.72);
  if (options.showBrand) drawBrandLockup(context, spec.width - spec.padding - 260, spec.padding * 0.28, palette);
}

function drawShareFooter(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const y = spec.height - spec.padding * 0.42;
  if (options.showBrand) {
    context.fillStyle = palette.text;
    context.font = `850 ${Math.max(14, Math.round(spec.width * 0.012))}px system-ui, sans-serif`;
    context.fillText("现场记 · Live Memory", spec.padding, y);
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(11, Math.round(spec.width * 0.009))}px system-ui, sans-serif`;
    context.fillText("GitHub · Qi-i/live-memory", spec.padding + Math.round(spec.width * 0.15), y);
  }
  if (options.showStats) {
    const cities = new Set(options.records.map((record) => record.city).filter(Boolean)).size;
    const watched = options.records.filter((record) => record.status === "watched").length;
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(11, Math.round(spec.width * 0.0095))}px system-ui, sans-serif`;
    context.textAlign = "right";
    context.fillText(`${cities} 城市 · ${watched} 已看`, spec.width - spec.padding, y);
    context.textAlign = "left";
  }
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, palette: PaletteDefinition) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(1, palette.background[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width * 0.8, height * 0.08, 0, width * 0.8, height * 0.08, width * 0.48);
  glow.addColorStop(0, `${palette.accentSoft}38`);
  glow.addColorStop(1, `${palette.accentSoft}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = `${palette.accent}28`;
  context.lineWidth = 2;
  for (let index = 0; index < 3; index += 1) {
    context.beginPath();
    context.arc(width * 0.88, height * 0.18, width * (0.18 + index * 0.06), Math.PI * 0.3, Math.PI * 1.55);
    context.stroke();
  }
}

function drawDetails(context: CanvasRenderingContext2D, record: EventRecord, slot: Rect, palette: PaletteDefinition) {
  const shade = context.createLinearGradient(0, slot.y + slot.height * 0.55, 0, slot.y + slot.height);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.9)");
  context.fillStyle = shade;
  context.fillRect(slot.x, slot.y + slot.height * 0.45, slot.width, slot.height * 0.55);
  const inset = Math.max(5, slot.width * 0.055);
  context.fillStyle = palette.accentSoft;
  context.font = `800 ${Math.max(8, slot.width * 0.055)}px system-ui, sans-serif`;
  context.fillText(record.date, slot.x + inset, slot.y + slot.height - inset * 3);
  context.fillStyle = "#ffffff";
  context.font = `900 ${Math.max(10, slot.width * 0.072)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, slot.width - inset * 2), slot.x + inset, slot.y + slot.height - inset * 1.15);
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
  context.fillStyle = background;
  context.fillRect(x, y, width, height);
  const overscan = 1.025;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * overscan;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawFallback(context: CanvasRenderingContext2D, record: EventRecord, x: number, y: number, width: number, height: number) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, record.colors[0] || "#172229");
  gradient.addColorStop(1, record.colors[1] || "#47645d");
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
  context.fillStyle = "rgba(255,255,255,.88)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${Math.max(13, Math.min(width, height) * 0.11)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, width * 0.76), x + width / 2, y + height / 2);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function drawBrandLockup(context: CanvasRenderingContext2D, x: number, y: number, palette: PaletteDefinition) {
  const size = 64;
  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, "#65e2ce");
  gradient.addColorStop(0.5, "#159b88");
  gradient.addColorStop(1, "#315ed8");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "white";
  context.lineWidth = 5;
  context.beginPath();
  context.arc(x + size * 0.46, y + size * 0.47, size * 0.27, Math.PI * 0.92, Math.PI * 1.78);
  context.stroke();
  context.strokeStyle = "rgba(255,255,255,.62)";
  context.beginPath();
  context.arc(x + size * 0.54, y + size * 0.53, size * 0.27, Math.PI * -0.08, Math.PI * 0.78);
  context.stroke();
  context.fillStyle = "#dfff4f";
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.text;
  context.font = "900 25px serif";
  context.fillText("现场记", x + size + 14, y + 28);
  context.fillStyle = palette.accent;
  context.font = "800 11px system-ui, sans-serif";
  context.fillText("LIVE MEMORY", x + size + 16, y + 49);
}

function roundedPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function wrapTextLines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const text = value.trim();
  if (!text) return [""];
  const lines: string[] = [];
  let remaining = text;
  while (remaining && lines.length < maxLines) {
    if (context.measureText(remaining).width <= maxWidth) {
      lines.push(remaining);
      remaining = "";
      break;
    }
    let cut = remaining.length;
    while (cut > 1 && context.measureText(remaining.slice(0, cut)).width > maxWidth) cut -= 1;
    if (cut <= 1) {
      lines.push(trimText(context, remaining, maxWidth));
      remaining = "";
      break;
    }
    lines.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining && lines.length) lines[lines.length - 1] = trimText(context, `${lines[lines.length - 1]}${remaining}`, maxWidth);
  return lines;
}

function trimText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 2 && context.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function alphaSurface(value: string, alpha: number) {
  if (value.startsWith("#") && value.length === 7) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
