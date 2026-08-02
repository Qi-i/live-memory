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
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BrandLockup } from "./brand";
import type { EventCategory, EventRecord } from "./domain";
import { categoryLabels, primaryMedia } from "./domain";
import { loadMediaImage, preloadRecordMedia, useCachedMediaSrc } from "./mediaCache";
import "./shareStudio.css";

export type ShareFormat = "landscape" | "portrait" | "square" | "long";
type ShareLayout = "wall" | "timeline" | "magazine" | "cities";
type SharePalette = "jade" | "midnight" | "paper" | "sunset";
type ScopeMode = "all" | "range" | "manual";
type ItemLimit = 12 | 20 | 30 | "all";
type SortMode = "date-desc" | "date-asc";

type Rect = { x: number; y: number; width: number; height: number };
type PosterSlot = { record: EventRecord; rect: Rect; emphasis?: "hero" | "feature" | "normal" };
type TimelineBand = { label: string; count: number; rect: Rect; slots: PosterSlot[] };
type CityBand = { label: string; count: number; rect: Rect; slots: PosterSlot[] };
type CityNode = { label: string; x: number; y: number; count: number };

interface ShareStudioProps {
  records: EventRecord[];
  format: ShareFormat;
  setFormat: (format: ShareFormat) => void;
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
}

const categoryOptions: EventCategory[] = ["concert", "festival", "livehouse", "theatre", "other"];

const layoutOptions: Array<{ value: ShareLayout; label: string; description: string; icon: ReactNode }> = [
  { value: "wall", label: "密集海报墙", description: "按原比例紧密拼接，适合一次分享很多现场", icon: <Grid3X3 /> },
  { value: "timeline", label: "时间长卷", description: "按年份分带，突出观演经历的时间脉络", icon: <Rows3 /> },
  { value: "magazine", label: "编目杂志", description: "主视觉、次重点与密集补位形成清晰层级", icon: <LayoutTemplate /> },
  { value: "cities", label: "城市路线", description: "用非地图坐标场呈现城市足迹与场次分布", icon: <MapPinned /> },
];

const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "jade", label: "翡翠绿" },
  { value: "midnight", label: "深海蓝" },
  { value: "paper", label: "极简白" },
  { value: "sunset", label: "暖砂金" },
];

const palettes: Record<SharePalette, PaletteDefinition> = {
  jade: {
    background: ["#e5f7ef", "#74bca9"],
    surface: "#f5fbf8",
    text: "#10201b",
    muted: "#4d6f64",
    accent: "#0b8f78",
    accentSoft: "#dfff4f",
    border: "rgba(11, 86, 73, .18)",
  },
  midnight: {
    background: ["#07151a", "#18384a"],
    surface: "#102129",
    text: "#f7fffb",
    muted: "#9bb1b3",
    accent: "#63dfca",
    accentSoft: "#dfff4f",
    border: "rgba(255, 255, 255, .22)",
  },
  paper: {
    background: ["#f8f4eb", "#dfd8ca"],
    surface: "#fffdf7",
    text: "#191d1c",
    muted: "#6e7470",
    accent: "#167e6e",
    accentSoft: "#d8b17a",
    border: "rgba(24, 31, 29, .16)",
  },
  sunset: {
    background: ["#f5e5d2", "#c78565"],
    surface: "#fff5e9",
    text: "#2d1c19",
    muted: "#78584f",
    accent: "#8e3d31",
    accentSoft: "#f0be65",
    border: "rgba(74, 35, 28, .2)",
  },
};

const cityCoordinateFallbacks: Record<string, [number, number]> = {
  北京: [116.4, 39.9], 上海: [121.47, 31.23], 广州: [113.27, 23.13], 深圳: [114.06, 22.54],
  成都: [104.07, 30.67], 重庆: [106.55, 29.56], 西安: [108.94, 34.34], 武汉: [114.31, 30.59],
  南京: [118.8, 32.06], 杭州: [120.16, 30.27], 苏州: [120.58, 31.3], 天津: [117.2, 39.12],
  郑州: [113.63, 34.75], 长沙: [112.94, 28.23], 青岛: [120.38, 36.07], 济南: [117.12, 36.65],
  昆明: [102.83, 25.04], 厦门: [118.09, 24.48], 福州: [119.3, 26.08], 南昌: [115.86, 28.68],
  合肥: [117.23, 31.82], 沈阳: [123.43, 41.8], 哈尔滨: [126.64, 45.76], 长春: [125.32, 43.82],
  乌鲁木齐: [87.62, 43.83], 拉萨: [91.13, 29.65], 兰州: [103.84, 36.06], 西宁: [101.78, 36.62],
  银川: [106.23, 38.49], 呼和浩特: [111.75, 40.84], 海口: [110.2, 20.04], 三亚: [109.51, 18.25],
  香港: [114.17, 22.32], 澳门: [113.54, 22.2], 台北: [121.56, 25.04],
};

export function ShareStudio({ records, format, setFormat, onClose }: ShareStudioProps) {
  const eligibleRecords = useMemo(
    () => records
      .filter((record) => primaryMedia(record))
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
  const [itemLimit, setItemLimit] = useState<ItemLimit>(20);
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
  const watched = selectedRecords.filter((record) => record.status === "watched").length;
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

  useEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    recalculateFit();
    const observer = new ResizeObserver(recalculateFit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [recalculateFit]);

  useEffect(() => {
    setManualScale(null);
  }, [format, layout, selectedRecords.length]);

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
          <strong>{selectedRecords.length}</strong><span>张海报进入成图</span><small>{period} · {cities} 个城市 · {sortMode === "date-desc" ? "最新在前" : "最早在前"}</small>
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

        <section className="share-control-group">
          <strong>最多使用</strong>
          <div className="share-count-control">
            {([12, 20, 30, "all"] as ItemLimit[]).map((count) => (
              <button className={itemLimit === count ? "is-active" : ""} key={count} type="button" onClick={() => setItemLimit(count)}>{count === "all" ? "全部" : `${count} 张`}</button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong>成图比例</strong>
          <div className="share-format-control">
            {(["portrait", "square", "landscape", "long"] as ShareFormat[]).map((item) => (
              <button className={format === item ? "is-active" : ""} key={item} type="button" onClick={() => setFormat(item)}>
                {item === "portrait" ? "竖版 4:5" : item === "square" ? "方形 1:1" : item === "landscape" ? "横版 16:9" : "手机长图"}
              </button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong>分享布局 <small>四种布局会真实改变海报组织方式</small></strong>
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
          <Download />{preparing ? "正在准备海报…" : saving ? "正在生成…" : saved ? "已保存到下载目录" : `保存 ${selectedRecords.length} 张海报的 PNG`}
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
              {showBrand ? <BrandLockup compact inverse={palette === "midnight"} size={44} /> : null}
            </header>
            <SharePreviewLayout records={selectedRecords} layout={layout} spec={spec} showDetails={showDetails} />
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

function SharePreviewLayout({ records, layout, spec, showDetails }: { records: EventRecord[]; layout: ShareLayout; spec: CanvasSpec; showDetails: boolean }) {
  const area = contentArea(spec);
  if (!records.length) return <div className="share-preview-empty">请选择至少一张海报</div>;

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
      <div className="share-layout-canvas" style={rectStyle(area)}>
        <section className="share-coordinate-field" style={localRectStyle(model.mapRect, area)}>
          <header><b>全国足迹坐标场</b><span>非地图示意 · 不绘制国界</span></header>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={model.nodes.map((node) => `${node.x},${node.y}`).join(" ")} />
          </svg>
          {model.nodes.map((node) => <i key={node.label} style={{ left: `${node.x}%`, top: `${node.y}%` } as CSSProperties}><b>{node.label}</b><small>{node.count}</small></i>)}
          <footer>经纬度归一化显示，仅用于个人演出足迹排布</footer>
        </section>
        <div className="share-city-bands" style={localRectStyle(model.listRect, area)}>
          {model.bands.map((band) => (
            <section key={band.label} style={{ height: band.rect.height }}>
              <header><b>{band.label}</b><span>{band.count} 场</span></header>
              <div>
                {band.slots.map((slot) => <PosterFigure key={slot.record.id} slot={slot} origin={band.rect} showDetails={showDetails} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const slots = layout === "magazine" ? buildMagazineSlots(records, area, spec) : buildJustifiedSlots(records, area, spec);
  return (
    <div className={`share-layout-canvas share-layout-canvas-${layout}`} style={rectStyle(area)}>
      {slots.map((slot) => <PosterFigure key={slot.record.id} slot={slot} origin={area} showDetails={showDetails} />)}
    </div>
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
  return clamp(media.width / media.height, 0.56, 1.32);
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

function buildJustifiedSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
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

function buildMagazineSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
  if (!records.length) return [];
  const gap = spec.width >= 1500 ? 15 : 12;
  let columns = records.length <= 8 ? 3 : records.length <= 24 ? 4 : 5;
  if (spec.width >= 1500) columns += 1;
  const columnWidth = (area.width - gap * (columns - 1)) / columns;
  const heights = Array.from({ length: columns }, () => 0);
  const slots: PosterSlot[] = [];

  records.forEach((record, index) => {
    const ratio = recordPosterRatio(record);
    const requestedSpan = index === 0 ? Math.min(3, columns - 1) : index < 3 ? Math.min(2, columns - 1) : 1;
    const span = Math.max(1, Math.min(requestedSpan, columns));
    let bestColumn = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let start = 0; start <= columns - span; start += 1) {
      const y = Math.max(...heights.slice(start, start + span));
      if (y < bestY) { bestY = y; bestColumn = start; }
    }
    const width = columnWidth * span + gap * (span - 1);
    const height = width / ratio;
    const x = area.x + bestColumn * (columnWidth + gap);
    const y = area.y + bestY;
    const emphasis = index === 0 ? "hero" : index < 3 ? "feature" : "normal";
    slots.push({ record, rect: { x, y, width, height }, emphasis });
    for (let column = bestColumn; column < bestColumn + span; column += 1) heights[column] = bestY + height + gap;
  });

  const totalHeight = Math.max(...heights, 1) - gap;
  if (totalHeight > area.height) {
    const scale = area.height / totalHeight;
    const scaledWidth = area.width * scale;
    const offsetX = area.x + (area.width - scaledWidth) / 2;
    return slots.map((slot) => ({
      ...slot,
      rect: {
        x: offsetX + (slot.rect.x - area.x) * scale,
        y: area.y + (slot.rect.y - area.y) * scale,
        width: slot.rect.width * scale,
        height: slot.rect.height * scale,
      },
    }));
  }
  const offsetY = (area.height - totalHeight) / 2;
  return slots.map((slot) => ({ ...slot, rect: { ...slot.rect, y: slot.rect.y + offsetY } }));
}

function buildTimelineBands(records: EventRecord[], area: Rect, spec: CanvasSpec): TimelineBand[] {
  const groups = groupByYear(records);
  const gap = spec.format === "long" ? 22 : 14;
  const bandHeight = (area.height - gap * Math.max(0, groups.length - 1)) / Math.max(1, groups.length);
  return groups.map((group, index) => {
    const rect = { x: area.x, y: area.y + index * (bandHeight + gap), width: area.width, height: bandHeight };
    const labelWidth = clamp(area.width * 0.13, 104, 170);
    const posterArea = { x: rect.x + labelWidth, y: rect.y + 10, width: rect.width - labelWidth - 10, height: rect.height - 20 };
    const slots = fitSingleBand(group.records, posterArea, spec.width >= 1500 ? 11 : 9);
    return { label: group.label, count: group.records.length, rect, slots };
  });
}

function fitSingleBand(records: EventRecord[], area: Rect, gap: number): PosterSlot[] {
  if (!records.length) return [];
  const ratios = records.map(recordPosterRatio);
  const ratioSum = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const heightByWidth = (area.width - gap * Math.max(0, records.length - 1)) / Math.max(0.01, ratioSum);
  const height = Math.min(area.height, heightByWidth);
  const totalWidth = ratios.reduce((sum, ratio) => sum + ratio * height, 0) + gap * Math.max(0, records.length - 1);
  let x = area.x + Math.max(0, (area.width - totalWidth) / 2);
  const y = area.y + (area.height - height) / 2;
  return records.map((record, index) => {
    const width = ratios[index] * height;
    const slot = { record, rect: { x, y, width, height } };
    x += width + gap;
    return slot;
  });
}

function buildCityModel(records: EventRecord[], area: Rect, spec: CanvasSpec) {
  const groups = groupByCity(records);
  const gap = spec.width >= 1500 ? 20 : 16;
  const mapWidth = area.width * (spec.width >= 1500 ? 0.42 : 0.4);
  const mapRect = { x: area.x, y: area.y, width: mapWidth, height: area.height };
  const listRect = { x: area.x + mapWidth + gap, y: area.y, width: area.width - mapWidth - gap, height: area.height };
  const bandGap = 10;
  const bandHeight = (listRect.height - bandGap * Math.max(0, groups.length - 1)) / Math.max(1, groups.length);
  const bands: CityBand[] = groups.map((group, index) => {
    const rect = { x: listRect.x, y: listRect.y + index * (bandHeight + bandGap), width: listRect.width, height: bandHeight };
    const labelWidth = clamp(rect.width * 0.22, 92, 150);
    const posterArea = { x: rect.x + labelWidth, y: rect.y + 8, width: rect.width - labelWidth - 8, height: rect.height - 16 };
    return { label: group.label, count: group.records.length, rect, slots: fitSingleBand(group.records, posterArea, 8) };
  });
  const nodes = groups.map((group) => {
    const [lng, lat] = cityCoordinate(group.label, group.records);
    return {
      label: group.label,
      x: clamp((lng - 73) / (135 - 73) * 82 + 9, 7, 93),
      y: clamp((54 - lat) / (54 - 18) * 72 + 15, 12, 88),
      count: group.records.length,
    };
  });
  return { mapRect, listRect, bands, nodes };
}

function cityCoordinate(label: string, records: EventRecord[]): [number, number] {
  const points = records.map((record) => record.coordinates).filter(Boolean);
  if (points.length) {
    const lng = points.reduce((sum, point) => sum + (point?.lng || 0), 0) / points.length;
    const lat = points.reduce((sum, point) => sum + (point?.lat || 0), 0) / points.length;
    return [lng, lat];
  }
  if (cityCoordinateFallbacks[label]) return cityCoordinateFallbacks[label];
  const seed = Array.from(label).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return [80 + (seed % 4800) / 100, 21 + (seed % 2900) / 100];
}

function centerSlots(slots: PosterSlot[], area: Rect) {
  if (!slots.length) return slots;
  const top = Math.min(...slots.map((slot) => slot.rect.y));
  const bottom = Math.max(...slots.map((slot) => slot.rect.y + slot.rect.height));
  const offsetY = Math.max(0, (area.height - (bottom - top)) / 2);
  return slots.map((slot) => ({ ...slot, rect: { ...slot.rect, y: slot.rect.y + offsetY } }));
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

function getCanvasSpec(format: ShareFormat, count: number, layout: ShareLayout, records: EventRecord[]): CanvasSpec {
  const width = format === "landscape" ? 1600 : 1200;
  const padding = format === "landscape" ? 58 : 54;
  const headerHeight = format === "landscape" ? 132 : 156;
  const footerHeight = 66;
  if (format !== "long") {
    return { width, height: format === "landscape" ? 900 : format === "square" ? 1200 : 1500, padding, headerHeight, footerHeight, format };
  }
  const groupCount = layout === "timeline" ? groupByYear(records).length : layout === "cities" ? groupByCity(records).length : 0;
  const contentHeight = layout === "timeline"
    ? Math.max(960, groupCount * 300)
    : layout === "cities"
      ? Math.max(980, groupCount * 250)
      : layout === "magazine"
        ? Math.max(980, Math.ceil(Math.max(1, count) / 4) * 290)
        : Math.max(980, Math.ceil(Math.max(1, count) / 4) * 265);
  return { width, height: padding * 2 + headerHeight + footerHeight + contentHeight, padding, headerHeight, footerHeight, format };
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
  else {
    const slots = options.layout === "magazine" ? buildMagazineSlots(options.records, area, spec) : buildJustifiedSlots(options.records, area, spec);
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

async function drawTimelineCanvas(context: CanvasRenderingContext2D, bands: TimelineBand[], options: ExportOptions, palette: PaletteDefinition) {
  for (const band of bands) {
    roundedPath(context, band.rect.x, band.rect.y, band.rect.width, band.rect.height, 18);
    context.fillStyle = alphaSurface(palette.surface, 0.78);
    context.fill();
    context.strokeStyle = palette.border;
    context.stroke();
    context.fillStyle = palette.accent;
    context.fillRect(band.rect.x + 18, band.rect.y + 18, 5, band.rect.height - 36);
    context.fillStyle = palette.text;
    context.font = "900 34px system-ui, sans-serif";
    context.fillText(band.label, band.rect.x + 38, band.rect.y + 54);
    context.fillStyle = palette.muted;
    context.font = "800 15px system-ui, sans-serif";
    context.fillText(`${band.count} 场现场`, band.rect.x + 40, band.rect.y + 82);
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
  context.fillStyle = alphaSurface(palette.surface, 0.72);
  context.fill();
  context.save();
  roundedPath(context, map.x, map.y, map.width, map.height, 22);
  context.clip();
  context.strokeStyle = `${palette.accent}25`;
  context.lineWidth = 1;
  for (let index = 1; index < 10; index += 1) {
    const x = map.x + map.width * index / 10;
    const y = map.y + map.height * index / 10;
    context.beginPath(); context.moveTo(x, map.y); context.lineTo(x, map.y + map.height); context.stroke();
    context.beginPath(); context.moveTo(map.x, y); context.lineTo(map.x + map.width, y); context.stroke();
  }
  if (model.nodes.length > 1) {
    context.strokeStyle = palette.accent;
    context.lineWidth = 3;
    context.beginPath();
    model.nodes.forEach((node, index) => {
      const x = map.x + map.width * node.x / 100;
      const y = map.y + map.height * node.y / 100;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }
  model.nodes.forEach((node) => {
    const x = map.x + map.width * node.x / 100;
    const y = map.y + map.height * node.y / 100;
    context.fillStyle = palette.accentSoft;
    context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fill();
    context.strokeStyle = palette.accent; context.lineWidth = 3; context.stroke();
    context.fillStyle = palette.text; context.font = "900 15px system-ui, sans-serif"; context.fillText(node.label, x + 16, y + 5);
  });
  context.restore();
  context.fillStyle = palette.text; context.font = "900 27px system-ui, sans-serif"; context.fillText("全国足迹坐标场", map.x + 24, map.y + 40);
  context.fillStyle = palette.muted; context.font = "800 13px system-ui, sans-serif"; context.fillText("非地图示意 · 不绘制国界", map.x + 25, map.y + 64);
  context.font = "750 11px system-ui, sans-serif"; context.fillText("经纬度归一化显示，仅用于个人演出足迹排布", map.x + 24, map.y + map.height - 22);

  for (const band of model.bands) {
    roundedPath(context, band.rect.x, band.rect.y, band.rect.width, band.rect.height, 16);
    context.fillStyle = alphaSurface(palette.surface, 0.78);
    context.fill();
    context.strokeStyle = palette.border;
    context.stroke();
    context.fillStyle = palette.text;
    context.font = "900 24px system-ui, sans-serif";
    context.fillText(band.label, band.rect.x + 18, band.rect.y + 38);
    context.fillStyle = palette.muted;
    context.font = "800 12px system-ui, sans-serif";
    context.fillText(`${band.count} 场`, band.rect.x + 20, band.rect.y + 60);
    for (const slot of band.slots) await drawPoster(context, slot.record, slot.rect, palette, options.showDetails);
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
  if (image) drawContain(context, image, slot.x, slot.y, slot.width, slot.height, palette.surface);
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
  context.font = `900 ${Math.round(spec.width * (options.format === "landscape" ? 0.037 : 0.049))}px system-ui, sans-serif`;
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

function drawContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
  context.fillStyle = background;
  context.fillRect(x, y, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
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
