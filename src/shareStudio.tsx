import {
  Download,
  Github,
  Grid3X3,
  Image as ImageIcon,
  LayoutTemplate,
  Palette,
  Rows3,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { EventRecord } from "./domain";
import { primaryMedia } from "./domain";
import { loadMediaImage, preloadRecordMedia, useCachedMediaSrc } from "./mediaCache";
import "./shareStudio.css";

export type ShareFormat = "landscape" | "portrait" | "square";
type ShareLayout = "collage" | "grid" | "timeline" | "cover";
type SharePalette = "midnight" | "paper" | "mint" | "sunset";

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

const layoutOptions: Array<{ value: ShareLayout; label: string; description: string; icon: ReactNode }> = [
  { value: "collage", label: "层叠海报", description: "突出主海报", icon: <LayoutTemplate /> },
  { value: "grid", label: "整齐网格", description: "信息更完整", icon: <Grid3X3 /> },
  { value: "timeline", label: "时间线", description: "按日期浏览", icon: <Rows3 /> },
  { value: "cover", label: "主海报", description: "集中展示一场", icon: <ImageIcon /> },
];

const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "midnight", label: "深色" },
  { value: "paper", label: "米白" },
  { value: "mint", label: "薄荷" },
  { value: "sunset", label: "暖色" },
];

const palettes: Record<SharePalette, PaletteDefinition> = {
  midnight: {
    background: ["#081014", "#1b2a30"],
    surface: "#10191e",
    text: "#f7f8f3",
    muted: "#9aa9ad",
    accent: "#dfff4f",
    border: "rgba(255,255,255,.78)",
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
    background: ["#dff6e9", "#a8dac8"],
    surface: "#effaf4",
    text: "#10201b",
    muted: "#4e6f64",
    accent: "#0c8a73",
    border: "rgba(20,25,25,.18)",
  },
  sunset: {
    background: ["#361d31", "#d2765e"],
    surface: "#4b2939",
    text: "#fff7ef",
    muted: "#e8c8bf",
    accent: "#ffd45f",
    border: "rgba(255,255,255,.78)",
  },
};

export function ShareStudio({ records, format, setFormat, onClose }: ShareStudioProps) {
  const [layout, setLayout] = useState<ShareLayout>("collage");
  const [palette, setPalette] = useState<SharePalette>("mint");
  const [headline, setHeadline] = useState("我的现场档案");
  const [itemLimit, setItemLimit] = useState<4 | 6 | 8>(6);
  const [showDetails, setShowDetails] = useState(true);
  const [showBrand, setShowBrand] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState("");

  const maxItems = Math.min(itemLimit, layout === "timeline" ? 8 : format === "portrait" ? 8 : 6);
  const selected = useMemo(
    () => records.filter((record) => primaryMedia(record)).slice(0, maxItems),
    [maxItems, records],
  );
  const years = useMemo(
    () => Array.from(new Set(records.map((record) => record.date.slice(0, 4)).filter(Boolean))).sort(),
    [records],
  );
  const period = years.length ? `${years[0]}—${years[years.length - 1]}` : String(new Date().getFullYear());
  const watched = records.filter((record) => record.status === "watched").length;
  const cities = new Set(records.map((record) => record.city).filter(Boolean)).size;

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
    void preloadRecordMedia(selected).finally(() => {
      if (active) setPreparing(false);
    });
    return () => { active = false; };
  }, [selected]);

  async function savePng() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await exportSharePng({ records, format, layout, palette, headline: headline.trim() || "我的现场档案", itemLimit, showDetails, showBrand, showStats });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    } catch (caught) {
      console.error("Share PNG export failed", caught);
      setError("图片生成失败。请稍后重试；无法跨域读取的外部图片会自动改用色块。");
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
            <span>分享制作</span>
            <h2>制作你的现场分享图</h2>
            <p>选择比例、海报编排和背景，右侧会即时呈现最终效果。</p>
          </div>
          <button type="button" aria-label="退出分享制作" title="关闭（Esc）" onClick={onClose}><X /></button>
        </header>

        <div className="share-studio-summary"><strong>{selected.length}</strong><span>张海报已就绪</span><small>{period} · {cities} 个城市</small></div>

        <section className="share-control-group">
          <strong>分享标题</strong>
          <input className="share-headline-input" value={headline} maxLength={24} onChange={(event) => setHeadline(event.target.value)} placeholder="输入分享图标题" />
        </section>

        <section className="share-control-group">
          <strong>图片比例</strong>
          <div className="share-format-control">
            {(["landscape", "portrait", "square"] as ShareFormat[]).map((item) => (
              <button className={format === item ? "is-active" : ""} key={item} type="button" onClick={() => setFormat(item)}>
                {item === "landscape" ? "横版 16:9" : item === "portrait" ? "竖版 3:4" : "方形 1:1"}
              </button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong>海报排列</strong>
          <div className="share-layout-control">
            {layoutOptions.map((item) => (
              <button className={layout === item.value ? "is-active" : ""} key={item.value} type="button" onClick={() => setLayout(item.value)}>
                {item.icon}<span><b>{item.label}</b><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="share-control-group">
          <strong>海报数量</strong>
          <div className="share-count-control">
            {([4, 6, 8] as const).map((count) => <button className={itemLimit === count ? "is-active" : ""} key={count} type="button" onClick={() => setItemLimit(count)}>{count} 张</button>)}
          </div>
        </section>

        <section className="share-control-group">
          <strong><Palette />背景</strong>
          <div className="share-palette-control">
            {paletteOptions.map((item) => (
              <button className={palette === item.value ? "is-active" : ""} data-palette={item.value} key={item.value} type="button" onClick={() => setPalette(item.value)}>
                <i /><span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="share-switches">
          <label>
            <input type="checkbox" checked={showDetails} onChange={(event) => setShowDetails(event.target.checked)} />
            <span><b>显示演出信息</b><small>展示日期、城市和演出名称。</small></span>
          </label>
          <label>
            <input type="checkbox" checked={showBrand} onChange={(event) => setShowBrand(event.target.checked)} />
            <span><b>显示项目标识</b><small>保留“现场记”和 GitHub 项目标识。</small></span>
          </label>
          <label>
            <input type="checkbox" checked={showStats} onChange={(event) => setShowStats(event.target.checked)} />
            <span><b>显示档案统计</b><small>展示城市数和已看场次。</small></span>
          </label>
        </section>

        {error && <p className="share-export-error">{error}</p>}
        <button className="share-export-button" type="button" disabled={saving || preparing || !selected.length} onClick={() => void savePng()}>
          <Download />{preparing ? "正在准备海报…" : saving ? "正在生成…" : saved ? "已保存到下载目录" : "保存 PNG 图片"}
        </button>
        <p className="share-export-note">按 Esc、右上角关闭或点击预览区外侧可返回。图片只在浏览器中生成，不会上传。</p>
      </aside>

      <main className="share-preview-area" onMouseDown={(event) => event.stopPropagation()}>
        <article className={`share-preview share-preview-${format} share-layout-${layout}`}>
          <span className="share-preview-aura" aria-hidden="true" />
          <header>
            <div><span>LIVE MEMORY · CONCERT ARCHIVE</span><h1>{headline.trim() || "我的现场档案"}</h1><p>{period} · {records.length} 场演出</p></div>
            <strong>演</strong>
          </header>
          <div className="share-preview-posters">
            {selected.map((record, index) => (
              <figure className={`share-item-${index + 1}`} key={record.id}>
                <SharePoster record={record} />
                {showDetails && <figcaption><span>{record.date} · {record.city || "城市待补"}</span><b>{record.title}</b><em>{record.artists.join(" / ")}</em></figcaption>}
              </figure>
            ))}
          </div>
          <footer>
            {showBrand ? <>
              <span className="share-preview-brand"><i>演</i><b>现场记</b></span>
              <span className="share-preview-github"><Github />Qi-i/live-memory</span>
            </> : <span />}
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
  return <img src={src} alt={record.title} decoding="async" />;
}

interface ExportOptions {
  records: EventRecord[];
  format: ShareFormat;
  layout: ShareLayout;
  palette: SharePalette;
  headline: string;
  itemLimit: 4 | 6 | 8;
  showDetails: boolean;
  showBrand: boolean;
  showStats: boolean;
}

async function exportSharePng(options: ExportOptions) {
  const dimensions: Record<ShareFormat, [number, number]> = {
    landscape: [1600, 900],
    portrait: [1080, 1440],
    square: [1200, 1200],
  };
  const [width, height] = dimensions[options.format];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  await document.fonts?.ready;

  const palette = palettes[options.palette];
  drawBackground(context, width, height, palette);
  const padding = Math.round(width * 0.052);
  const headerHeight = Math.round(height * 0.17);
  const footerHeight = Math.round(height * 0.07);

  context.fillStyle = palette.accent;
  context.font = `800 ${Math.max(18, Math.round(width * 0.016))}px system-ui, sans-serif`;
  context.fillText("LIVE MEMORY · CONCERT ARCHIVE", padding, padding * 0.82);
  context.fillStyle = palette.text;
  context.font = `900 ${Math.round(width * (options.format === "portrait" ? 0.061 : 0.047))}px system-ui, sans-serif`;
  context.fillText(options.headline, padding, padding + headerHeight * 0.42);

  const years = Array.from(new Set(options.records.map((record) => record.date.slice(0, 4)).filter(Boolean))).sort();
  const period = years.length ? `${years[0]}—${years[years.length - 1]}` : String(new Date().getFullYear());
  context.fillStyle = palette.muted;
  context.font = `700 ${Math.max(16, Math.round(width * 0.015))}px system-ui, sans-serif`;
  context.fillText(`${period} · ${options.records.length} 场演出`, padding, padding + headerHeight * 0.72);
  drawLogo(context, width - padding - Math.round(width * 0.052), padding * 0.45, Math.round(width * 0.052), palette);

  const maxItems = Math.min(options.itemLimit, options.layout === "timeline" ? 8 : options.format === "portrait" ? 8 : 6);
  const selected = options.records.filter((record) => primaryMedia(record)).slice(0, maxItems);
  const area = {
    x: padding,
    y: padding + headerHeight,
    width: width - padding * 2,
    height: height - padding - headerHeight - footerHeight,
  };
  const slots = makeSlots(options.layout, options.format, selected.length, area);
  const orderedSlots = slots.map((slot, index) => ({ slot, index })).sort((a, b) => (a.slot.z || 0) - (b.slot.z || 0));
  for (const { slot, index } of orderedSlots) {
    const record = selected[index];
    if (!record) continue;
    await drawRecord(context, record, slot, palette, options.showDetails, options.layout === "timeline");
  }

  const footerY = height - padding * 0.42;
  if (options.showBrand) {
    context.fillStyle = palette.text;
    context.font = `850 ${Math.max(15, Math.round(width * 0.015))}px system-ui, sans-serif`;
    context.fillText("现场记", padding, footerY);
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(13, Math.round(width * 0.012))}px system-ui, sans-serif`;
    context.fillText("GitHub · Qi-i/live-memory", padding + Math.round(width * 0.075), footerY);
  }
  const cities = new Set(options.records.map((record) => record.city).filter(Boolean)).size;
  const watched = options.records.filter((record) => record.status === "watched").length;
  if (options.showStats) {
    context.fillStyle = palette.muted;
    context.font = `700 ${Math.max(13, Math.round(width * 0.012))}px system-ui, sans-serif`;
    context.textAlign = "right";
    context.fillText(`${cities} 城市 · ${watched} 已看`, width - padding, footerY);
    context.textAlign = "left";
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
  if (!blob) throw new Error("PNG export failed");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `现场档案-${options.format}-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, palette: PaletteDefinition) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(0.52, palette.surface);
  gradient.addColorStop(1, palette.background[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.76, height * 0.2, 0, width * 0.76, height * 0.2, width * 0.46);
  glow.addColorStop(0, `${palette.accent}42`);
  glow.addColorStop(1, `${palette.accent}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.14;
  context.strokeStyle = palette.accent;
  context.lineWidth = Math.max(2, width * 0.0015);
  for (let index = 0; index < 4; index += 1) {
    context.beginPath();
    context.ellipse(width * 0.77, height * 0.78, width * (0.2 + index * 0.055), height * (0.08 + index * 0.025), -0.16, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

interface Slot { x: number; y: number; width: number; height: number; rotation?: number; z?: number; }

function makeSlots(layout: ShareLayout, format: ShareFormat, count: number, area: Slot): Slot[] {
  if (!count) return [];
  const gap = Math.round(Math.min(area.width, area.height) * 0.018);
  if (layout === "timeline") {
    const rowHeight = (area.height - gap * (count - 1)) / count;
    return Array.from({ length: count }, (_, index) => ({
      x: area.x,
      y: area.y + index * (rowHeight + gap),
      width: area.width,
      height: rowHeight,
    }));
  }
  if (layout === "grid") {
    const columns = format === "landscape" ? 3 : 2;
    const rows = Math.ceil(count / columns);
    const cellWidth = (area.width - gap * (columns - 1)) / columns;
    const cellHeight = (area.height - gap * (rows - 1)) / rows;
    return Array.from({ length: count }, (_, index) => ({
      x: area.x + (index % columns) * (cellWidth + gap),
      y: area.y + Math.floor(index / columns) * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
    }));
  }
  if (layout === "cover") {
    if (format === "portrait") {
      const mainHeight = area.height * 0.55;
      const slots: Slot[] = [{ x: area.x, y: area.y, width: area.width, height: mainHeight }];
      const remaining = count - 1;
      if (!remaining) return slots;
      const columns = 2;
      const rows = Math.ceil(remaining / columns);
      const cellWidth = (area.width - gap) / columns;
      const cellHeight = (area.height - mainHeight - gap - gap * (rows - 1)) / rows;
      for (let index = 0; index < remaining; index += 1) slots.push({
        x: area.x + (index % columns) * (cellWidth + gap),
        y: area.y + mainHeight + gap + Math.floor(index / columns) * (cellHeight + gap),
        width: cellWidth,
        height: cellHeight,
      });
      return slots;
    }
    const mainWidth = area.width * 0.61;
    const slots: Slot[] = [{ x: area.x, y: area.y, width: mainWidth, height: area.height }];
    const remaining = count - 1;
    if (!remaining) return slots;
    const sideWidth = area.width - mainWidth - gap;
    const sideHeight = (area.height - gap * (remaining - 1)) / remaining;
    for (let index = 0; index < remaining; index += 1) slots.push({
      x: area.x + mainWidth + gap,
      y: area.y + index * (sideHeight + gap),
      width: sideWidth,
      height: sideHeight,
    });
    return slots;
  }

  const normalized: Array<[number, number, number, number, number, number]> = format === "portrait"
    ? [
      [0.13, 0.02, 0.74, 0.48, -1, 5],
      [0.02, 0.44, 0.46, 0.32, -5, 2],
      [0.52, 0.43, 0.46, 0.34, 5, 3],
      [0.08, 0.73, 0.39, 0.24, -3, 1],
      [0.53, 0.73, 0.39, 0.24, 3, 1],
      [0.33, 0.67, 0.34, 0.27, 0, 4],
    ]
    : [
      [0.34, 0.02, 0.32, 0.94, -1, 6],
      [0.11, 0.12, 0.28, 0.76, -7, 3],
      [0.59, 0.10, 0.27, 0.78, 6, 4],
      [0.76, 0.19, 0.22, 0.65, 10, 2],
      [0.01, 0.28, 0.22, 0.57, -10, 1],
      [0.70, 0.33, 0.20, 0.54, 3, 1],
    ];
  return normalized.slice(0, count).map(([x, y, slotWidth, slotHeight, rotation, z]) => ({
    x: area.x + x * area.width,
    y: area.y + y * area.height,
    width: slotWidth * area.width,
    height: slotHeight * area.height,
    rotation,
    z,
  }));
}

async function drawRecord(
  context: CanvasRenderingContext2D,
  record: EventRecord,
  slot: Slot,
  palette: PaletteDefinition,
  showDetails: boolean,
  timeline: boolean,
) {
  const radius = Math.max(10, slot.width * 0.025);
  const rotation = (slot.rotation || 0) * Math.PI / 180;
  context.save();
  let x = slot.x;
  let y = slot.y;
  if (rotation) {
    context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
    context.rotate(rotation);
    x = -slot.width / 2;
    y = -slot.height / 2;
  }

  context.shadowColor = "rgba(18, 35, 34, .28)";
  context.shadowBlur = Math.max(12, slot.width * 0.065);
  context.shadowOffsetY = Math.max(6, slot.height * 0.025);
  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.fillStyle = palette.surface;
  context.fill();
  context.shadowColor = "transparent";

  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.clip();
  context.fillStyle = palette.surface;
  context.fillRect(x, y, slot.width, slot.height);

  const image = await loadMediaImage(primaryMedia(record));
  const localSlot = { ...slot, x, y };
  if (timeline) {
    const imageWidth = Math.min(slot.width * 0.22, slot.height * 0.9);
    if (image) drawCover(context, image, x, y, imageWidth, slot.height);
    else drawFallback(context, record, x, y, imageWidth, slot.height);
    const textX = x + imageWidth + slot.height * 0.2;
    context.fillStyle = palette.accent;
    context.font = `800 ${Math.max(12, slot.height * 0.15)}px system-ui, sans-serif`;
    context.fillText(`${record.date} · ${record.city || "城市待补"}`, textX, y + slot.height * 0.38);
    context.fillStyle = palette.text;
    context.font = `900 ${Math.max(15, slot.height * 0.23)}px system-ui, sans-serif`;
    context.fillText(trimText(context, record.title, x + slot.width - textX - 18), textX, y + slot.height * 0.69);
  } else {
    if (image) drawCover(context, image, x, y, slot.width, slot.height);
    else drawFallback(context, record, x, y, slot.width, slot.height);
    if (showDetails) drawDetails(context, record, localSlot, palette);
  }
  context.strokeStyle = palette.border;
  context.lineWidth = Math.max(2, slot.width * 0.007);
  roundedPath(context, x, y, slot.width, slot.height, radius);
  context.stroke();
  context.restore();
}

function drawDetails(context: CanvasRenderingContext2D, record: EventRecord, slot: Slot, palette: PaletteDefinition) {
  const shade = context.createLinearGradient(0, slot.y + slot.height * 0.48, 0, slot.y + slot.height);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.9)");
  context.fillStyle = shade;
  context.fillRect(slot.x, slot.y + slot.height * 0.43, slot.width, slot.height * 0.57);
  const inset = Math.max(12, slot.width * 0.045);
  context.fillStyle = palette.accent;
  context.font = `800 ${Math.max(10, slot.width * 0.033)}px system-ui, sans-serif`;
  context.fillText(`${record.date} · ${record.city || "城市待补"}`, slot.x + inset, slot.y + slot.height - inset * 3.0);
  context.fillStyle = "#ffffff";
  context.font = `900 ${Math.max(14, slot.width * 0.052)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, slot.width - inset * 2), slot.x + inset, slot.y + slot.height - inset * 1.25);
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
  context.font = `900 ${Math.max(18, Math.min(width, height) * 0.13)}px system-ui, sans-serif`;
  context.fillText(trimText(context, record.title, width * 0.76), x + width / 2, y + height / 2);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawLogo(context: CanvasRenderingContext2D, x: number, y: number, size: number, palette: PaletteDefinition) {
  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, palette.accent);
  gradient.addColorStop(1, palette.background[1]);
  context.fillStyle = gradient;
  roundedPath(context, x, y, size, size, size * 0.18);
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
