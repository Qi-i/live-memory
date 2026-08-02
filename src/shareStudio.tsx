import {
  ArrowDownWideNarrow,
  CalendarRange,
  Download,
  Grid3X3,
  LayoutTemplate,
  MapPinned,
  Palette,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
  { value: "wall", label: "密集海报墙", description: "高密度陈列，适合一次分享很多现场", icon: <Grid3X3 /> },
  { value: "timeline", label: "时间长卷", description: "按年份分段，让观演经历形成时间脉络", icon: <Rows3 /> },
  { value: "magazine", label: "编目杂志", description: "主海报与小海报错落，强调视觉重点", icon: <LayoutTemplate /> },
  { value: "cities", label: "城市路线", description: "按城市串联场次，突出你的现场足迹", icon: <MapPinned /> },
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
  }), [scope, scopedRecords, sortMode]);

  const selectedRecords = useMemo(() => itemLimit === "all" ? sortedRecords : sortedRecords.slice(0, itemLimit), [itemLimit, sortedRecords]);

  const visibleSelectionRecords = useMemo(() => {
    const query = selectionQuery.trim().toLowerCase();
    const source = categoryFilteredRecords;
    if (!query) return source;
    return source.filter((record) => [record.title, record.city, record.venue, record.artists.join(" "), record.date]
      .join(" ").toLowerCase().includes(query));
  }, [categoryFilteredRecords, selectionQuery]);

  const period = useMemo(() => formatPeriod(selectedRecords), [selectedRecords]);
  const watched = selectedRecords.filter((record) => record.status === "watched").length;
  const cities = new Set(selectedRecords.map((record) => record.city).filter(Boolean)).size;
  const spec = useMemo(() => getCanvasSpec(format, selectedRecords.length, layout, selectedRecords), [format, layout, selectedRecords]);
  const previewStyle = { "--share-preview-ratio": `${spec.width} / ${spec.height}` } as CSSProperties;

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
              <button
                className={categories.has(category) ? "is-active" : ""}
                key={category}
                type="button"
                disabled={!categoryCounts.get(category)}
                onClick={() => toggleCategory(category)}
              >
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

      <main className="share-preview-area" onMouseDown={(event) => event.stopPropagation()}>
        <article className={`share-preview share-preview-${format} share-layout-${layout}`} style={previewStyle}>
          <span className="share-preview-aura" aria-hidden="true" />
          <header>
            <div><span>LIVE MEMORY · CONCERT ARCHIVE</span><h1>{headline.trim() || "我的现场档案"}</h1><p>{period} · {selectedRecords.length} 场演出 · {sortMode === "date-desc" ? "最新在前" : "最早在前"}</p></div>
            {showBrand ? <BrandLockup compact inverse={palette === "midnight"} size={44} /> : null}
          </header>
          <SharePreviewLayout records={selectedRecords} layout={layout} showDetails={showDetails} />
          <footer>
            {showBrand ? <span className="share-preview-github">GitHub · Qi-i/live-memory</span> : <span />}
            {showStats ? <strong>{cities} 城市 · {watched} 已看</strong> : <strong />}
          </footer>
        </article>
      </main>
    </section>
  );
}

function SharePreviewLayout({ records, layout, showDetails }: { records: EventRecord[]; layout: ShareLayout; showDetails: boolean }) {
  if (layout === "timeline") {
    return (
      <div className="share-preview-timeline">
        {groupByYear(records).map((group) => (
          <section key={group.label}>
            <header><b>{group.label}</b><span>{group.records.length} 场</span></header>
            <div>{group.records.map((record) => <PosterFigure key={record.id} record={record} showDetails={showDetails} />)}</div>
          </section>
        ))}
      </div>
    );
  }
  if (layout === "magazine") {
    return (
      <div className="share-preview-magazine">
        {records.map((record, index) => <PosterFigure className={magazineClass(index)} key={record.id} record={record} showDetails={showDetails} />)}
      </div>
    );
  }
  if (layout === "cities") {
    return (
      <div className="share-preview-cities">
        <span className="share-city-route" aria-hidden="true" />
        {groupByCity(records).map((group, index) => (
          <section key={group.label}>
            <header><i>{String(index + 1).padStart(2, "0")}</i><span><b>{group.label}</b><small>{group.records.length} 场现场</small></span></header>
            <div>{group.records.map((record) => <PosterFigure key={record.id} record={record} showDetails={showDetails} />)}</div>
          </section>
        ))}
      </div>
    );
  }
  return <div className="share-preview-wall">{records.map((record) => <PosterFigure key={record.id} record={record} showDetails={showDetails} />)}</div>;
}

function PosterFigure({ record, showDetails, className = "" }: { record: EventRecord; showDetails: boolean; className?: string }) {
  return (
    <figure className={className}>
      <SharePoster record={record} />
      {showDetails ? <figcaption><span>{record.date} · {record.city || categoryLabels[record.category]}</span><b>{record.title}</b></figcaption> : null}
    </figure>
  );
}

function SharePoster({ record }: { record: EventRecord }) {
  const media = primaryMedia(record);
  const src = useCachedMediaSrc(media);
  const style = { "--poster-a": record.colors[0], "--poster-b": record.colors[1] } as CSSProperties;
  if (!src) return <span className="share-poster-frame"><span className="share-poster-fallback" style={style}>{record.title.slice(0, 4)}</span></span>;
  return <span className="share-poster-frame"><img className="share-poster-foreground" src={src} alt={record.title} decoding="async" /></span>;
}

function magazineClass(index: number) {
  if (index === 0) return "is-hero";
  if (index === 1 || index === 6) return "is-wide";
  if (index % 7 === 0) return "is-tall";
  return "";
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

  if (options.layout === "timeline") await drawTimelineCanvas(context, spec, options, palette);
  else if (options.layout === "magazine") await drawMagazineCanvas(context, spec, options, palette);
  else if (options.layout === "cities") await drawCitiesCanvas(context, spec, options, palette);
  else await drawWallCanvas(context, spec, options, palette);

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

function getCanvasSpec(format: ShareFormat, count: number, layout: ShareLayout, records: EventRecord[]): CanvasSpec {
  const width = format === "landscape" ? 1600 : 1200;
  const padding = format === "landscape" ? 64 : 58;
  const headerHeight = format === "landscape" ? 150 : 180;
  const footerHeight = 78;
  if (format !== "long") {
    return { width, height: format === "landscape" ? 900 : format === "square" ? 1200 : 1500, padding, headerHeight, footerHeight };
  }
  if (layout === "timeline") {
    const years = Math.max(1, groupByYear(records).length);
    return { width, height: padding + headerHeight + years * 310 + footerHeight + padding, padding, headerHeight, footerHeight };
  }
  if (layout === "cities") {
    const cities = Math.max(1, groupByCity(records).length);
    return { width, height: padding + headerHeight + cities * 300 + footerHeight + padding, padding, headerHeight, footerHeight };
  }
  const columns = layout === "magazine" ? 4 : 5;
  const rows = Math.ceil(Math.max(1, count) / columns);
  return { width, height: padding + headerHeight + rows * 285 + footerHeight + padding, padding, headerHeight, footerHeight };
}

function contentArea(spec: CanvasSpec) {
  return {
    x: spec.padding,
    y: spec.padding + spec.headerHeight,
    width: spec.width - spec.padding * 2,
    height: spec.height - spec.padding * 2 - spec.headerHeight - spec.footerHeight,
  };
}

async function drawWallCanvas(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const area = contentArea(spec);
  const count = Math.max(1, options.records.length);
  const targetColumns = options.format === "landscape" ? (count <= 12 ? 6 : count <= 24 ? 8 : 10) : options.format === "square" ? (count <= 12 ? 4 : count <= 24 ? 6 : 7) : count <= 12 ? 4 : count <= 24 ? 5 : 6;
  const slots = fitGrid(area, count, targetColumns, 4 / 5, 12);
  for (let index = 0; index < options.records.length; index += 1) {
    await drawPoster(context, options.records[index], slots[index], palette, options.showDetails, 0);
  }
}

async function drawTimelineCanvas(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const area = contentArea(spec);
  const groups = groupByYear(options.records);
  const bandGap = 22;
  const bandHeight = (area.height - bandGap * Math.max(0, groups.length - 1)) / Math.max(1, groups.length);
  context.strokeStyle = palette.accent;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(area.x + 52, area.y + 20);
  context.lineTo(area.x + 52, area.y + area.height - 20);
  context.stroke();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const y = area.y + groupIndex * (bandHeight + bandGap);
    context.fillStyle = palette.accentSoft;
    context.beginPath();
    context.arc(area.x + 52, y + 30, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.text;
    context.font = `900 ${Math.max(26, spec.width * 0.025)}px system-ui, sans-serif`;
    context.fillText(group.label, area.x + 82, y + 39);
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(13, spec.width * 0.011)}px system-ui, sans-serif`;
    context.fillText(`${group.records.length} 场现场`, area.x + 82, y + 62);
    const local = { x: area.x + 220, y: y + 2, width: area.width - 220, height: bandHeight - 4 };
    const columns = Math.min(group.records.length || 1, options.format === "landscape" ? 8 : 6);
    const slots = fitGrid(local, group.records.length, columns, 4 / 5, 10);
    for (let index = 0; index < group.records.length; index += 1) {
      await drawPoster(context, group.records[index], slots[index], palette, options.showDetails, 0);
    }
  }
}

async function drawMagazineCanvas(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const area = contentArea(spec);
  if (!options.records.length) return;
  const gap = 18;
  const heroWidth = options.format === "landscape" ? area.width * 0.31 : area.width * 0.43;
  const heroHeight = Math.min(area.height, heroWidth / (4 / 5));
  const heroY = area.y + Math.max(0, (area.height - heroHeight) / 2);
  await drawPoster(context, options.records[0], { x: area.x, y: heroY, width: heroWidth, height: heroHeight }, palette, true, -0.012);
  const remaining = options.records.slice(1);
  if (!remaining.length) return;
  const gridArea = { x: area.x + heroWidth + gap, y: area.y, width: area.width - heroWidth - gap, height: area.height };
  const columns = options.format === "landscape" ? 5 : options.format === "square" ? 4 : 3;
  const slots = fitGrid(gridArea, remaining.length, columns, 4 / 5, 12);
  for (let index = 0; index < remaining.length; index += 1) {
    const rotation = ((index % 5) - 2) * 0.008;
    await drawPoster(context, remaining[index], slots[index], palette, options.showDetails, rotation);
  }
  context.strokeStyle = palette.accent;
  context.lineWidth = 2;
  context.setLineDash([10, 12]);
  context.strokeRect(area.x + heroWidth + gap / 2, area.y, 1, area.height);
  context.setLineDash([]);
}

async function drawCitiesCanvas(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const area = contentArea(spec);
  const groups = groupByCity(options.records);
  const bandGap = 18;
  const bandHeight = (area.height - bandGap * Math.max(0, groups.length - 1)) / Math.max(1, groups.length);
  const lineX = area.x + 46;
  context.strokeStyle = palette.accent;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(lineX, area.y + 18);
  context.bezierCurveTo(lineX + 36, area.y + area.height * 0.3, lineX - 30, area.y + area.height * 0.7, lineX + 18, area.y + area.height - 18);
  context.stroke();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const y = area.y + groupIndex * (bandHeight + bandGap);
    context.fillStyle = palette.accentSoft;
    context.beginPath();
    context.arc(lineX + (groupIndex % 2 ? 10 : -4), y + 34, 14, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.text;
    context.font = `900 ${Math.max(24, spec.width * 0.023)}px system-ui, sans-serif`;
    context.fillText(group.label, area.x + 82, y + 42);
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(12, spec.width * 0.011)}px system-ui, sans-serif`;
    context.fillText(`${group.records.length} 场`, area.x + 84, y + 65);
    const local = { x: area.x + 220, y: y + 2, width: area.width - 220, height: bandHeight - 4 };
    const columns = Math.min(group.records.length || 1, options.format === "landscape" ? 8 : 6);
    const slots = fitGrid(local, group.records.length, columns, 4 / 5, 10);
    for (let index = 0; index < group.records.length; index += 1) {
      await drawPoster(context, group.records[index], slots[index], palette, options.showDetails, 0);
    }
  }
}

function fitGrid(area: { x: number; y: number; width: number; height: number }, count: number, columns: number, ratio: number, gap: number) {
  const safeCount = Math.max(1, count);
  const safeColumns = Math.max(1, Math.min(columns, safeCount));
  const rows = Math.ceil(safeCount / safeColumns);
  const widthByColumns = (area.width - gap * (safeColumns - 1)) / safeColumns;
  const heightByWidth = widthByColumns / ratio;
  const heightByRows = (area.height - gap * Math.max(0, rows - 1)) / rows;
  const height = Math.min(heightByWidth, heightByRows);
  const width = height * ratio;
  const gridWidth = width * safeColumns + gap * Math.max(0, safeColumns - 1);
  const gridHeight = height * rows + gap * Math.max(0, rows - 1);
  const startX = area.x + Math.max(0, (area.width - gridWidth) / 2);
  const startY = area.y + Math.max(0, (area.height - gridHeight) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index % safeColumns) * (width + gap),
    y: startY + Math.floor(index / safeColumns) * (height + gap),
    width,
    height,
  }));
}

function drawShareHeader(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const x = spec.padding;
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.max(17, Math.round(spec.width * 0.014))}px system-ui, sans-serif`;
  context.fillText("LIVE MEMORY · CONCERT ARCHIVE", x, spec.padding * 0.72);
  context.fillStyle = palette.text;
  context.font = `900 ${Math.round(spec.width * (options.format === "landscape" ? 0.039 : 0.052))}px system-ui, sans-serif`;
  context.fillText(trimText(context, options.headline, spec.width - spec.padding * 4.5), x, spec.padding + spec.headerHeight * 0.45);
  context.fillStyle = palette.muted;
  context.font = `700 ${Math.max(15, Math.round(spec.width * 0.013))}px system-ui, sans-serif`;
  context.fillText(`${formatPeriod(options.records)} · ${options.records.length} 场演出 · ${options.sortMode === "date-desc" ? "最新在前" : "最早在前"}`, x, spec.padding + spec.headerHeight * 0.72);
  if (options.showBrand) drawBrandLockup(context, spec.width - spec.padding - 260, spec.padding * 0.28, palette);
}

function drawShareFooter(context: CanvasRenderingContext2D, spec: CanvasSpec, options: ExportOptions, palette: PaletteDefinition) {
  const y = spec.height - spec.padding * 0.45;
  if (options.showBrand) {
    context.fillStyle = palette.text;
    context.font = `850 ${Math.max(14, Math.round(spec.width * 0.013))}px system-ui, sans-serif`;
    context.fillText("现场记 · Live Memory", spec.padding, y);
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(11, Math.round(spec.width * 0.0095))}px system-ui, sans-serif`;
    context.fillText("GitHub · Qi-i/live-memory", spec.padding + Math.round(spec.width * 0.15), y);
  }
  if (options.showStats) {
    const cities = new Set(options.records.map((record) => record.city).filter(Boolean)).size;
    const watched = options.records.filter((record) => record.status === "watched").length;
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(11, Math.round(spec.width * 0.01))}px system-ui, sans-serif`;
    context.textAlign = "right";
    context.fillText(`${cities} 城市 · ${watched} 已看`, spec.width - spec.padding, y);
    context.textAlign = "left";
  }
}

async function drawPoster(
  context: CanvasRenderingContext2D,
  record: EventRecord,
  slot: { x: number; y: number; width: number; height: number },
  palette: PaletteDefinition,
  showDetails: boolean,
  rotation: number,
) {
  context.save();
  context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
  context.rotate(rotation);
  const x = -slot.width / 2;
  const y = -slot.height / 2;
  const radius = Math.max(4, slot.width * 0.04);
  context.shadowColor = "rgba(0,0,0,.2)";
  context.shadowBlur = Math.max(4, slot.width * 0.07);
  context.shadowOffsetY = Math.max(2, slot.width * 0.025);
  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.fillStyle = palette.surface;
  context.fill();
  context.shadowColor = "transparent";
  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.clip();

  const image = await loadMediaImage(primaryMedia(record));
  if (image) drawCover(context, image, x, y, slot.width, slot.height);
  else drawFallback(context, record, x, y, slot.width, slot.height);
  if (showDetails) drawDetails(context, record, { x, y, width: slot.width, height: slot.height }, palette);
  context.restore();

  context.save();
  context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
  context.rotate(rotation);
  context.strokeStyle = palette.border;
  context.lineWidth = Math.max(1, slot.width * 0.008);
  roundedPath(context, -slot.width / 2, -slot.height / 2, slot.width, slot.height, radius);
  context.stroke();
  context.restore();
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

function drawDetails(context: CanvasRenderingContext2D, record: EventRecord, slot: { x: number; y: number; width: number; height: number }, palette: PaletteDefinition) {
  const shade = context.createLinearGradient(0, slot.y + slot.height * 0.54, 0, slot.y + slot.height);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.9)");
  context.fillStyle = shade;
  context.fillRect(slot.x, slot.y + slot.height * 0.46, slot.width, slot.height * 0.54);
  const inset = Math.max(5, slot.width * 0.055);
  context.fillStyle = palette.accentSoft;
  context.font = `800 ${Math.max(8, slot.width * 0.055)}px system-ui, sans-serif`;
  context.fillText(record.date, slot.x + inset, slot.y + slot.height - inset * 3);
  context.fillStyle = "#ffffff";
  context.font = `900 ${Math.max(10, slot.width * 0.072)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, slot.width - inset * 2), slot.x + inset, slot.y + slot.height - inset * 1.15);
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
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
