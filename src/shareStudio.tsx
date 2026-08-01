import {
  Download,
  Github,
  Grid3X3,
  LayoutTemplate,
  Palette,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { EventRecord } from "./domain";
import { primaryMedia } from "./domain";
import { loadMediaImage, preloadRecordMedia, useCachedMediaSrc } from "./mediaCache";
import "./shareStudio.css";

export type ShareFormat = "landscape" | "portrait" | "square" | "long";
type ShareLayout = "dense" | "catalog" | "staggered";
type SharePalette = "midnight" | "paper" | "mint" | "sunset";
type ScopeMode = "all" | "range" | "manual";
type ItemLimit = 12 | 20 | 30 | "all";

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
  border: string;
}

interface GridSpec {
  width: number;
  height: number;
  columns: number;
  rows: number;
  gap: number;
  headerHeight: number;
  footerHeight: number;
  padding: number;
}

const layoutOptions: Array<{ value: ShareLayout; label: string; description: string; icon: ReactNode }> = [
  { value: "dense", label: "密集海报墙", description: "适合 20 张以上", icon: <Grid3X3 /> },
  { value: "catalog", label: "海报目录", description: "保留标题与日期", icon: <Rows3 /> },
  { value: "staggered", label: "错落画报", description: "保持竖版轻微旋转", icon: <LayoutTemplate /> },
];

const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "midnight", label: "深夜" },
  { value: "paper", label: "米白" },
  { value: "mint", label: "薄荷" },
  { value: "sunset", label: "暖霞" },
];

const palettes: Record<SharePalette, PaletteDefinition> = {
  midnight: {
    background: ["#071114", "#1a2d31"],
    surface: "#101a1e",
    text: "#f7f8f3",
    muted: "#9aa9ad",
    accent: "#dfff4f",
    border: "rgba(255,255,255,.72)",
  },
  paper: {
    background: ["#f4efe4", "#ddd5c5"],
    surface: "#fffaf0",
    text: "#17191d",
    muted: "#6d706f",
    accent: "#0b8e7d",
    border: "rgba(20,25,25,.18)",
  },
  mint: {
    background: ["#dff6e9", "#9fd6c4"],
    surface: "#effaf4",
    text: "#10201b",
    muted: "#4e6f64",
    accent: "#0c8a73",
    border: "rgba(20,25,25,.18)",
  },
  sunset: {
    background: ["#321d30", "#d2765e"],
    surface: "#4b2939",
    text: "#fff7ef",
    muted: "#e8c8bf",
    accent: "#ffd45f",
    border: "rgba(255,255,255,.72)",
  },
};

export function ShareStudio({ records, format, setFormat, onClose }: ShareStudioProps) {
  const eligibleRecords = useMemo(
    () => records.filter((record) => primaryMedia(record)).slice().sort((a, b) => a.date.localeCompare(b.date)),
    [records],
  );
  const earliestDate = eligibleRecords[0]?.date || "";
  const latestDate = eligibleRecords.length ? eligibleRecords[eligibleRecords.length - 1].date : "";
  const [layout, setLayout] = useState<ShareLayout>("dense");
  const [palette, setPalette] = useState<SharePalette>("mint");
  const [headline, setHeadline] = useState("我的现场档案");
  const [scope, setScope] = useState<ScopeMode>("all");
  const [itemLimit, setItemLimit] = useState<ItemLimit>("all");
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
    () => Array.from(new Set(eligibleRecords.map((record) => record.date.slice(0, 4)).filter(Boolean))).sort(),
    [eligibleRecords],
  );

  useEffect(() => {
    setStartDate((current: string) => current || earliestDate);
    setEndDate((current: string) => current || latestDate);
    setSelectedIds((current: Set<string>) => {
      const valid = new Set(eligibleRecords.filter((record) => current.has(record.id)).map((record) => record.id));
      return valid.size ? valid : new Set(eligibleRecords.map((record) => record.id));
    });
  }, [earliestDate, latestDate, eligibleRecords]);

  const scopedRecords = useMemo(() => {
    if (scope === "range") {
      return eligibleRecords.filter((record) => (!startDate || record.date >= startDate) && (!endDate || record.date <= endDate));
    }
    if (scope === "manual") return eligibleRecords.filter((record) => selectedIds.has(record.id));
    return eligibleRecords;
  }, [eligibleRecords, endDate, scope, selectedIds, startDate]);

  const selectedRecords = useMemo(() => {
    if (itemLimit === "all") return scopedRecords;
    return scopedRecords.slice(0, itemLimit);
  }, [itemLimit, scopedRecords]);

  const visibleSelectionRecords = useMemo(() => {
    const query = selectionQuery.trim().toLowerCase();
    if (!query) return eligibleRecords;
    return eligibleRecords.filter((record) => [record.title, record.city, record.venue, record.artists.join(" "), record.date]
      .join(" ").toLowerCase().includes(query));
  }, [eligibleRecords, selectionQuery]);

  const period = useMemo(() => formatPeriod(selectedRecords), [selectedRecords]);
  const watched = selectedRecords.filter((record) => record.status === "watched").length;
  const cities = new Set(selectedRecords.map((record) => record.city).filter(Boolean)).size;
  const gridSpec = useMemo(() => getGridSpec(format, selectedRecords.length, layout), [format, layout, selectedRecords.length]);
  const previewStyle = {
    "--share-columns": gridSpec.columns,
    "--share-rows": gridSpec.rows,
    "--share-preview-ratio": `${gridSpec.width} / ${gridSpec.height}`,
  } as CSSProperties;

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

  function toggleRecord(recordId: string) {
    setSelectedIds((current: Set<string>) => {
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
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    } catch (caught) {
      console.error("Share PNG export failed", caught);
      setError("图片生成失败。请稍后重试；无法读取的外部图片会自动改用色块。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`share-studio-stage share-theme-${palette}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="share-studio-panel" aria-label="分享图设置">
        <header>
          <div>
            <span>现场分享图</span>
            <h2>选择真正想分享的现场</h2>
            <p>支持时间范围、逐场选择和二十张以上的竖版海报墙。</p>
          </div>
          <button type="button" aria-label="退出分享制作" title="关闭（Esc）" onClick={onClose}><X /></button>
        </header>

        <div className="share-studio-summary">
          <strong>{selectedRecords.length}</strong><span>张海报进入成图</span><small>{period} · {cities} 个城市</small>
        </div>

        <section className="share-control-group">
          <strong>分享标题</strong>
          <input className="share-headline-input" value={headline} maxLength={24} onChange={(event) => setHeadline(event.target.value)} placeholder="输入分享图标题" />
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
            <label><Search /><input value={selectionQuery} onChange={(event) => setSelectionQuery(event.target.value)} placeholder="搜索标题、城市、日期" /></label>
            <div className="share-selection-actions">
              <button type="button" onClick={() => setSelectedIds(new Set(visibleSelectionRecords.map((record) => record.id)))}>选择当前结果</button>
              <button type="button" onClick={() => setSelectedIds(new Set<string>())}>清空</button>
            </div>
            <div className="share-selection-grid">
              {visibleSelectionRecords.map((record) => (
                <button className={selectedIds.has(record.id) ? "is-selected" : ""} type="button" key={record.id} onClick={() => toggleRecord(record.id)}>
                  <SharePoster record={record} />
                  <span><b>{record.title}</b><small>{record.date} · {record.city || "城市待补"}</small></span>
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
            {(["landscape", "portrait", "square", "long"] as ShareFormat[]).map((item) => (
              <button className={format === item ? "is-active" : ""} key={item} type="button" onClick={() => setFormat(item)}>
                {item === "landscape" ? "横版" : item === "portrait" ? "竖版" : item === "square" ? "方形" : "长图"}
              </button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong>海报编排</strong>
          <div className="share-layout-control">
            {layoutOptions.map((item) => (
              <button className={layout === item.value ? "is-active" : ""} key={item.value} type="button" onClick={() => setLayout(item.value)}>
                {item.icon}<span><b>{item.label}</b><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong><Palette />背景</strong>
          <div className="share-palette-control">
            {paletteOptions.map((item) => (
              <button className={palette === item.value ? "is-active" : ""} data-palette={item.value} key={item.value} type="button" onClick={() => setPalette(item.value)}><i /><span>{item.label}</span></button>
            ))}
          </div>
        </section>

        <section className="share-switches">
          <label><input type="checkbox" checked={showDetails} onChange={(event) => setShowDetails(event.target.checked)} /><span><b>海报信息</b><small>在海报底部叠加日期和标题。</small></span></label>
          <label><input type="checkbox" checked={showBrand} onChange={(event) => setShowBrand(event.target.checked)} /><span><b>项目标识</b><small>显示“现场记”和 GitHub 项目。</small></span></label>
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
            <div><span>LIVE MEMORY · CONCERT ARCHIVE</span><h1>{headline.trim() || "我的现场档案"}</h1><p>{period} · {selectedRecords.length} 场演出</p></div>
            <strong>演</strong>
          </header>
          <div className="share-preview-posters">
            {selectedRecords.map((record, index) => (
              <figure style={{ "--share-index": index } as CSSProperties} key={record.id}>
                <div className="share-poster-frame">
                  <SharePoster record={record} />
                  {showDetails && <figcaption><span>{record.date} · {record.city || "城市待补"}</span><b>{record.title}</b></figcaption>}
                </div>
              </figure>
            ))}
          </div>
          <footer>
            {showBrand ? <><span className="share-preview-brand"><i>演</i><b>现场记</b></span><span className="share-preview-github"><Github />Qi-i/live-memory</span></> : <span />}
            {showStats ? <strong>{cities} 城市 · {watched} 已看</strong> : <strong />}
          </footer>
        </article>
      </main>
    </section>
  );
}

function SharePoster({ record }: { record: EventRecord }) {
  const media = primaryMedia(record);
  const src = useCachedMediaSrc(media);
  const style = { "--poster-a": record.colors[0], "--poster-b": record.colors[1] } as CSSProperties;
  if (!src) return <span className="share-poster-fallback" style={style}>{record.title.slice(0, 4)}</span>;
  return (
    <span className="share-poster-image">
      <img className="share-poster-backdrop" src={src} alt="" aria-hidden="true" decoding="async" />
      <img className="share-poster-foreground" src={src} alt={record.title} decoding="async" />
    </span>
  );
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
}

async function exportSharePng(options: ExportOptions) {
  const spec = getGridSpec(options.format, options.records.length, options.layout);
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  await document.fonts?.ready;

  const palette = palettes[options.palette];
  drawBackground(context, spec.width, spec.height, palette);
  drawShareHeader(context, spec, options, palette);

  const areaTop = spec.padding + spec.headerHeight;
  const areaHeight = spec.height - spec.padding - spec.headerHeight - spec.footerHeight;
  const availableWidth = spec.width - spec.padding * 2;
  const posterWidthByGrid = (availableWidth - spec.gap * (spec.columns - 1)) / spec.columns;
  const posterHeightByGrid = posterWidthByGrid * 1.5;
  const requiredHeight = posterHeightByGrid * spec.rows + spec.gap * Math.max(0, spec.rows - 1);
  const posterHeight = requiredHeight <= areaHeight
    ? posterHeightByGrid
    : (areaHeight - spec.gap * Math.max(0, spec.rows - 1)) / spec.rows;
  const posterWidth = posterHeight / 1.5;
  const rowWidth = posterWidth * spec.columns + spec.gap * Math.max(0, spec.columns - 1);
  const startX = (spec.width - rowWidth) / 2;
  const startY = areaTop + Math.max(0, (areaHeight - (posterHeight * spec.rows + spec.gap * Math.max(0, spec.rows - 1))) / 2);

  for (let index = 0; index < options.records.length; index += 1) {
    const record = options.records[index];
    const column = index % spec.columns;
    const row = Math.floor(index / spec.columns);
    const x = startX + column * (posterWidth + spec.gap);
    const y = startY + row * (posterHeight + spec.gap);
    const rotation = options.layout === "staggered" ? ((index % 5) - 2) * 0.012 : 0;
    await drawPoster(context, record, { x, y, width: posterWidth, height: posterHeight }, palette, options.showDetails, options.layout, rotation);
  }

  drawShareFooter(context, spec, options, palette);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
  if (!blob) throw new Error("PNG export failed");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `现场记-${options.records.length}场-${options.format}-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getGridSpec(format: ShareFormat, count: number, layout: ShareLayout): GridSpec {
  const safeCount = Math.max(1, count);
  const columns = format === "landscape"
    ? safeCount <= 12 ? 6 : safeCount <= 24 ? 8 : safeCount <= 40 ? 10 : 12
    : format === "portrait"
      ? safeCount <= 12 ? 4 : safeCount <= 24 ? 5 : safeCount <= 40 ? 6 : 7
      : format === "square"
        ? safeCount <= 12 ? 4 : safeCount <= 24 ? 6 : safeCount <= 40 ? 7 : 8
        : safeCount > 40 ? 5 : 4;
  const rows = Math.ceil(safeCount / columns);
  const width = format === "landscape" ? 1600 : format === "square" ? 1200 : 1080;
  const padding = format === "landscape" ? 64 : 58;
  const headerHeight = format === "landscape" ? 150 : 190;
  const footerHeight = 92;
  const gap = layout === "dense" ? 10 : layout === "catalog" ? 18 : 24;
  if (format !== "long") {
    return {
      width,
      height: format === "landscape" ? 900 : format === "square" ? 1200 : 1440,
      columns,
      rows,
      gap,
      headerHeight,
      footerHeight,
      padding,
    };
  }
  const posterWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const posterHeight = posterWidth * 1.5;
  const contentHeight = rows * posterHeight + Math.max(0, rows - 1) * gap;
  return {
    width,
    height: Math.ceil(padding + headerHeight + contentHeight + footerHeight + padding),
    columns,
    rows,
    gap,
    headerHeight,
    footerHeight,
    padding,
  };
}

function formatPeriod(records: EventRecord[]) {
  if (!records.length) return "尚未选择";
  const dates = records.map((record) => record.date).filter(Boolean).sort();
  const first = dates[0];
  const last = dates[dates.length - 1] || first;
  if (first.slice(0, 4) === last.slice(0, 4)) return first.slice(0, 4);
  return `${first.slice(0, 4)}—${last.slice(0, 4)}`;
}

function drawShareHeader(context: CanvasRenderingContext2D, spec: GridSpec, options: ExportOptions, palette: PaletteDefinition) {
  const x = spec.padding;
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.max(17, Math.round(spec.width * 0.014))}px system-ui, sans-serif`;
  context.fillText("LIVE MEMORY · CONCERT ARCHIVE", x, spec.padding * 0.72);
  context.fillStyle = palette.text;
  context.font = `900 ${Math.round(spec.width * (options.format === "landscape" ? 0.038 : 0.052))}px system-ui, sans-serif`;
  context.fillText(trimText(context, options.headline, spec.width - spec.padding * 3.2), x, spec.padding + spec.headerHeight * 0.45);
  context.fillStyle = palette.muted;
  context.font = `700 ${Math.max(15, Math.round(spec.width * 0.013))}px system-ui, sans-serif`;
  context.fillText(`${formatPeriod(options.records)} · ${options.records.length} 场演出`, x, spec.padding + spec.headerHeight * 0.72);
  drawLogo(context, spec.width - spec.padding - Math.round(spec.width * 0.055), spec.padding * 0.34, Math.round(spec.width * 0.055), palette);
}

function drawShareFooter(context: CanvasRenderingContext2D, spec: GridSpec, options: ExportOptions, palette: PaletteDefinition) {
  const y = spec.height - spec.padding * 0.55;
  if (options.showBrand) {
    context.fillStyle = palette.text;
    context.font = `850 ${Math.max(15, Math.round(spec.width * 0.014))}px system-ui, sans-serif`;
    context.fillText("现场记", spec.padding, y);
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(12, Math.round(spec.width * 0.011))}px system-ui, sans-serif`;
    context.fillText("GitHub · Qi-i/live-memory", spec.padding + Math.round(spec.width * 0.078), y);
  }
  if (options.showStats) {
    const cities = new Set(options.records.map((record) => record.city).filter(Boolean)).size;
    const watched = options.records.filter((record) => record.status === "watched").length;
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(12, Math.round(spec.width * 0.011))}px system-ui, sans-serif`;
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
  layout: ShareLayout,
  rotation: number,
) {
  context.save();
  context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
  context.rotate(rotation);
  const x = -slot.width / 2;
  const y = -slot.height / 2;
  const radius = Math.max(4, slot.width * 0.035);
  context.shadowColor = "rgba(0,0,0,.20)";
  context.shadowBlur = layout === "dense" ? 4 : 14;
  context.shadowOffsetY = layout === "dense" ? 2 : 7;
  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.fillStyle = palette.surface;
  context.fill();
  context.shadowColor = "transparent";
  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.clip();

  const image = await loadMediaImage(primaryMedia(record));
  if (image) drawContain(context, image, x, y, slot.width, slot.height, palette.surface);
  else drawFallback(context, record, x, y, slot.width, slot.height);
  if (showDetails) drawDetails(context, record, { x, y, width: slot.width, height: slot.height }, palette);
  context.restore();

  if (layout !== "dense") {
    context.save();
    context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
    context.rotate(rotation);
    context.strokeStyle = palette.border;
    context.lineWidth = Math.max(1.5, slot.width * 0.012);
    roundedPath(context, -slot.width / 2, -slot.height / 2, slot.width, slot.height, radius);
    context.stroke();
    context.restore();
  }
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, palette: PaletteDefinition) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(1, palette.background[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width * 0.78, height * 0.08, 0, width * 0.78, height * 0.08, width * 0.42);
  glow.addColorStop(0, `${palette.accent}32`);
  glow.addColorStop(1, `${palette.accent}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
}

function drawDetails(context: CanvasRenderingContext2D, record: EventRecord, slot: { x: number; y: number; width: number; height: number }, palette: PaletteDefinition) {
  const shade = context.createLinearGradient(0, slot.y + slot.height * 0.56, 0, slot.y + slot.height);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.9)");
  context.fillStyle = shade;
  context.fillRect(slot.x, slot.y + slot.height * 0.48, slot.width, slot.height * 0.52);
  const inset = Math.max(5, slot.width * 0.055);
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.max(8, slot.width * 0.06)}px system-ui, sans-serif`;
  context.fillText(record.date, slot.x + inset, slot.y + slot.height - inset * 3.0);
  context.fillStyle = "#ffffff";
  context.font = `900 ${Math.max(10, slot.width * 0.078)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, slot.width - inset * 2), slot.x + inset, slot.y + slot.height - inset * 1.15);
}

function drawContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
  context.fillStyle = background;
  context.fillRect(x, y, width, height);

  context.save();
  context.filter = "blur(" + Math.max(7, width * 0.05) + "px) brightness(0.7) saturate(0.86)";
  drawCover(context, image, x - width * 0.08, y - height * 0.05, width * 1.16, height * 1.1);
  context.restore();

  context.fillStyle = "rgba(7, 15, 13, 0.08)";
  context.fillRect(x, y, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
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
  context.fillStyle = "rgba(255,255,255,.86)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${Math.max(13, Math.min(width, height) * 0.12)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, width * 0.76), x + width / 2, y + height / 2);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function drawLogo(context: CanvasRenderingContext2D, x: number, y: number, size: number, palette: PaletteDefinition) {
  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, palette.accent);
  gradient.addColorStop(1, palette.background[1]);
  context.fillStyle = gradient;
  roundedPath(context, x, y, size, size, size * 0.2);
  context.fill();
  context.fillStyle = palette.text;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${size * 0.48}px system-ui, sans-serif`;
  context.fillText("演", x + size / 2, y + size / 2);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
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
