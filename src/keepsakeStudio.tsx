import { Download, Image as ImageIcon, Loader2, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { EventRecord, MediaAsset } from "./domain";
import { categoryLabels, effectiveStatus, primaryMedia } from "./domain";
import { loadMediaImage } from "./mediaCache";
import "./keepsakeStudio.css";

export type KeepsakeSubject =
  | { kind: "record"; record: EventRecord }
  | { kind: "recap"; records: EventRecord[] };

type CanvasRatio = "feed" | "story";
type CardTheme = "night" | "paper" | "aurora";
interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  subtle: string;
  highlight: string;
  border: string;
}
const THEMES: Record<CardTheme, ThemeColors> = {
  night: { background: "#111c28", surface: "#233344", text: "#f9faf7", subtle: "#b6c7cc", highlight: "#8de3ce", border: "#475d6a" },
  paper: { background: "#f6f0e6", surface: "#e5dccc", text: "#17242a", subtle: "#5b6970", highlight: "#147b73", border: "#b6b7ad" },
  aurora: { background: "#17273f", surface: "#324c66", text: "#fcf7ef", subtle: "#c4d6db", highlight: "#e5c59d", border: "#64758a" },
};

export function KeepsakeStudio({ subject, onClose }: { subject: KeepsakeSubject; onClose: () => void }) {
  const [ratio, setRatio] = useState<CanvasRatio>("feed");
  const [theme, setTheme] = useState<CardTheme>("night");
  const [showVenue, setShowVenue] = useState(true);
  const [showBrand, setShowBrand] = useState(false);
  const [headline, setHeadline] = useState(subject.kind === "record" ? subject.record.title : "我的现场履历");
  const [imageUrl, setImageUrl] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const kind = subject.kind;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let localUrl = "";
    setBusy(true);
    setImageBlob(null);
    setImageUrl("");
    setError("");
    void renderKeepsake(subject, { ratio, theme, showVenue, showBrand, headline }).then((blob) => {
      if (cancelled) return;
      localUrl = URL.createObjectURL(blob);
      setImageBlob(blob);
      setImageUrl(localUrl);
      setBusy(false);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : "成图失败，请检查海报是否可读取。");
      setBusy(false);
    });
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [subject, ratio, theme, showVenue, showBrand, headline]);

  const filename = (kind === "record" ? subject.record.date + "-" + subject.record.title : "我的现场履历")
    .replace(/[\\/:*?"<>|]+/g, "-").slice(0, 65) + "-" + ratio + ".png";

  function download() {
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  async function share() {
    if (!imageBlob) return;
    const file = new File([imageBlob], filename, { type: "image/png" });
    const shareData = { files: [file], title: headline.trim() || "Live Memory" };
    if (!navigator.share || (navigator.canShare && !navigator.canShare(shareData))) {
      download();
      return;
    }
    try {
      await navigator.share(shareData);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("系统分享不可用，仍可使用“下载 PNG”保存图片。");
    }
  }

  return (
    <div className="keepsake-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="keepsake-dialog" role="dialog" aria-modal="true" aria-label={kind === "record" ? "单场演出纪念卡" : "个人观演回顾卡"}>
        <div className="keepsake-editor">
          <header className="keepsake-heading">
            <div><span>LIVE MEMORY · SHARE</span><h2>{kind === "record" ? "把这一场，做成纪念卡" : "把你的观演经历，做成回顾"}</h2><p>专为朋友圈设计的独立成图，不是缩小网页截图。</p></div>
            <button type="button" aria-label="关闭分享编辑器" onClick={onClose}><X /></button>
          </header>
          <label className="keepsake-label">分享标题
            <input type="text" value={headline} maxLength={50} onChange={(event) => setHeadline(event.target.value)} placeholder="输入自己的分享标题" />
          </label>
          <fieldset className="keepsake-options">
            <legend>图片比例</legend>
            <div className="keepsake-choice-row">
              <button className={ratio === "feed" ? "active" : ""} type="button" onClick={() => setRatio("feed")}>朋友圈 4:5<small>1080 × 1350</small></button>
              <button className={ratio === "story" ? "active" : ""} type="button" onClick={() => setRatio("story")}>手机长图 9:16<small>1080 × 1920</small></button>
            </div>
          </fieldset>
          <fieldset className="keepsake-options">
            <legend>视觉风格</legend>
            <div className="keepsake-choice-row keepsake-themes">
              {(["night", "paper", "aurora"] as CardTheme[]).map((value) => (
                <button className={theme === value ? "active" : ""} type="button" key={value} onClick={() => setTheme(value)}>
                  <i style={{ background: THEMES[value].background, borderColor: THEMES[value].highlight }} />
                  {value === "night" ? "深夜现场" : value === "paper" ? "纸感票根" : "极光蓝"}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="keepsake-toggles">
            <label><input type="checkbox" checked={showVenue} onChange={(event) => setShowVenue(event.target.checked)} /><span>显示城市与场馆</span></label>
            <label><input type="checkbox" checked={showBrand} onChange={(event) => setShowBrand(event.target.checked)} /><span>显示 Live Memory 标识</span></label>
          </div>
          <p className="keepsake-privacy">隐私保护：不输出座位、票价、同行人、备注、订单信息或票根二维码。图片仅在当前设备生成。</p>
          {error && <p className="keepsake-error" role="alert">{error}</p>}
          <div className="keepsake-actions">
            <button className="keepsake-primary" type="button" disabled={!imageBlob || busy} onClick={() => void share()}><Share2 />系统分享</button>
            <button type="button" disabled={!imageBlob || busy} onClick={download}><Download />下载 PNG</button>
          </div>
        </div>
        <div className="keepsake-preview-space">
          <div className="keepsake-preview-head"><span>LIVE PREVIEW</span><strong>{ratio === "feed" ? "4:5" : "9:16"} · PNG</strong></div>
          {busy ? <div className="keepsake-placeholder"><Loader2 className="spin" /><span>正在本地排版并读取海报…</span></div>
            : imageUrl ? <img className="keepsake-preview-image" src={imageUrl} alt="分享图片预览，可使用保存或分享按钮输出高清 PNG" />
              : <div className="keepsake-placeholder"><ImageIcon />图片暂不可预览</div>}
        </div>
      </section>
    </div>
  );
}

interface DrawOptions {
  ratio: CanvasRatio;
  theme: CardTheme;
  showVenue: boolean;
  showBrand: boolean;
  headline: string;
}

async function renderKeepsake(subject: KeepsakeSubject, options: DrawOptions): Promise<Blob> {
  const width = 1080;
  const height = options.ratio === "story" ? 1920 : 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("当前浏览器不支持 Canvas 高清导出");
  const palette = THEMES[options.theme];
  paintBackground(context, width, height, palette);
  if (subject.kind === "record") await paintEvent(context, subject.record, width, height, palette, options);
  else await paintRecap(context, subject.records, width, height, palette, options);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片生成失败，可能是外部海报禁止跨域读取")), "image/png");
    } catch (reason) {
      reject(reason instanceof Error ? reason : new Error("无法导出跨域海报，请检查图片来源"));
    }
  });
}

function paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number, p: ThemeColors) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, p.background);
  gradient.addColorStop(1, p.surface);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = p.highlight;
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.arc(1070, 0, 140 + i * 87, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, weight = 500, maxWidth?: number) {
  ctx.fillStyle = color;
  ctx.font = String(weight) + " " + size + "px system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(value, x, y, maxWidth);
}
function fitLines(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, lineHeight: number, maxLines: number, color: string) {
  ctx.font = "800 " + size + "px system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillStyle = color;
  const characters = Array.from(value.trim() || "一场值得记住的现场");
  const lines: string[] = [];
  let line = "";
  for (const char of characters) {
    if (ctx.measureText(line + char).width > width && line) {
      lines.push(line);
      line = char;
    } else line += char;
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    let last = visible[visible.length - 1];
    while (ctx.measureText(last + "…").width > width && last.length) last = last.slice(0, -1);
    visible[visible.length - 1] = last + "…";
  }
  visible.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
  return y + visible.length * lineHeight;
}
async function safeImage(media?: MediaAsset): Promise<HTMLImageElement | null> {
  try { return await loadMediaImage(media); } catch { return null; }
}
function drawContainedImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const factor = Math.min(width / iw, height / ih);
  const drawWidth = iw * factor;
  const drawHeight = ih * factor;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}
function drawFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: ThemeColors) {
  ctx.fillStyle = p.surface;
  ctx.fillRect(x, y, w, h);
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, p.background);
  gradient.addColorStop(1, p.surface);
  ctx.fillStyle = gradient;
  ctx.fillRect(x + 11, y + 11, w - 22, h - 22);
  ctx.strokeStyle = p.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}
function drawFooter(ctx: CanvasRenderingContext2D, height: number, p: ThemeColors, showBrand: boolean) {
  ctx.fillStyle = p.border;
  ctx.fillRect(74, height - 105, 932, 2);
  text(ctx, "COLLECT MOMENTS, NOT JUST TICKETS", 76, height - 57, 22, p.subtle, 650);
  if (showBrand) {
    ctx.textAlign = "right";
    text(ctx, "LIVE MEMORY", 1004, height - 57, 22, p.highlight, 850);
    ctx.textAlign = "left";
  }
}
async function paintEvent(ctx: CanvasRenderingContext2D, record: EventRecord, width: number, height: number, p: ThemeColors, options: DrawOptions) {
  const tall = height > 1500;
  text(ctx, "MY LIVE MOMENTS", 76, 102, 27, p.highlight, 850);
  ctx.textAlign = "right";
  text(ctx, categoryLabels[record.category] + "  /  " + (effectiveStatus(record) === "watched" ? "已看" : "待看"), 1004, 102, 24, p.subtle, 550);
  ctx.textAlign = "left";
  const heroY = 154;
  const heroHeight = tall ? 1172 : 690;
  drawFrame(ctx, 76, heroY, width - 152, heroHeight, p);
  const image = await safeImage(primaryMedia(record, ["poster", "livePhoto", "ticket"]));
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(89, heroY + 13, width - 178, heroHeight - 26);
    ctx.clip();
    drawContainedImage(ctx, image, 89, heroY + 13, width - 178, heroHeight - 26);
    ctx.restore();
  } else {
    ctx.textAlign = "center";
    text(ctx, "LIVE", width / 2, heroY + heroHeight / 2 - 12, 110, p.highlight, 850);
    text(ctx, "MOMENT", width / 2, heroY + heroHeight / 2 + 75, 50, p.subtle, 650);
    ctx.textAlign = "left";
  }
  let next = fitLines(ctx, options.headline, 76, heroY + heroHeight + 91, 915, tall ? 67 : 62, tall ? 83 : 75, 2, p.text);
  const artists = record.artists.join(" · ");
  if (artists) {
    text(ctx, artists, 79, next + 17, 29, p.highlight, 650, 910);
    next += 49;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(record.date) ? record.date.replace(/-/g, " / ") : "日期待补";
  text(ctx, date, 78, Math.min(next + 19, height - 193), 33, p.text, 720);
  if (options.showVenue && (record.city || record.venue)) {
    const location = [record.city, record.venue].filter(Boolean).join("  ·  ");
    text(ctx, location, 78, Math.min(next + 62, height - 145), 25, p.subtle, 550, 900);
  }
  drawFooter(ctx, height, p, options.showBrand);
}
async function paintRecap(ctx: CanvasRenderingContext2D, records: EventRecord[], width: number, height: number, p: ThemeColors, options: DrawOptions) {
  const tall = height > 1500;
  const ordered = [...records].filter((record) => !record.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
  const watched = ordered.filter((record) => effectiveStatus(record) === "watched");
  const cities = [...new Set(ordered.map((record) => record.city).filter(Boolean))];
  const years = ordered.map((record) => record.date.slice(0, 4)).filter((value) => /^\d{4}$/.test(value)).sort();
  const period = years.length ? (years[0] === years[years.length - 1] ? years[0] : years[0] + " — " + years[years.length - 1]) : "MY LIVE HISTORY";
  text(ctx, "MY LIVE MEMORY", 76, 100, 25, p.highlight, 850);
  ctx.textAlign = "right";
  text(ctx, period, 1004, 100, 25, p.subtle, 550);
  ctx.textAlign = "left";
  const next = fitLines(ctx, options.headline, 75, 212, 924, 80, 96, 2, p.text);
  const statsY = Math.max(270, next + 37);
  const stats = [{ label: "收录现场", value: ordered.length }, { label: "已经看过", value: watched.length }, { label: "到访城市", value: cities.length }];
  const statW = 292;
  stats.forEach((stat, i) => {
    const x = 76 + i * 316;
    ctx.fillStyle = p.surface;
    ctx.fillRect(x, statsY, statW, 176);
    text(ctx, String(stat.value).padStart(2, "0"), x + 24, statsY + 92, 69, p.text, 850);
    text(ctx, stat.label, x + 26, statsY + 142, 23, p.subtle, 590);
  });
  const collageY = statsY + 230;
  const collageHeight = tall ? 920 : 535;
  const posters = await Promise.all(ordered.filter((record) => primaryMedia(record, ["poster", "livePhoto"])).slice(0, 4)
    .map(async (record) => ({ record, image: await safeImage(primaryMedia(record, ["poster", "livePhoto"])) })));
  const cols = 2, gap = 18, cardWidth = (928 - gap) / cols, cardHeight = (collageHeight - gap) / 2;
  for (let index = 0; index < 4; index += 1) {
    const col = index % 2, row = Math.floor(index / 2);
    const x = 76 + col * (cardWidth + gap), y = collageY + row * (cardHeight + gap);
    drawFrame(ctx, x, y, cardWidth, cardHeight, p);
    const item = posters[index];
    if (item?.image) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 10, y + 10, cardWidth - 20, cardHeight - 20);
      ctx.clip();
      drawContainedImage(ctx, item.image, x + 10, y + 10, cardWidth - 20, cardHeight - 20);
      ctx.restore();
    } else {
      ctx.textAlign = "center";
      text(ctx, "LIVE", x + cardWidth / 2, y + cardHeight / 2, 47, p.subtle, 760);
      ctx.textAlign = "left";
    }
  }
  const caption = options.showVenue
    ? (cities.length ? "到过  " + cities.slice(0, 5).join("  /  ") : "每一场都是新的目的地")
    : "记住每一次抵达现场的心跳";
  text(ctx, caption, 77, collageY + collageHeight + (tall ? 86 : 60), tall ? 30 : 24, p.text, 600, 916);
  drawFooter(ctx, height, p, options.showBrand);
}
