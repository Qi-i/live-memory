import { readFile, writeFile } from "node:fs/promises";

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
}

const tsPath = "src/shareStudio.tsx";
let ts = await readFile(tsPath, "utf8");

ts = replaceExact(ts, `            {selectedRecords.map((record, index) => (
              <figure style={{ "--share-index": index } as CSSProperties} key={record.id}>
                <SharePoster record={record} />
                {showDetails && <figcaption><span>{record.date} · {record.city || "城市待补"}</span><b>{record.title}</b></figcaption>}
              </figure>
            ))}`, `            {selectedRecords.map((record, index) => (
              <figure style={{ "--share-index": index } as CSSProperties} key={record.id}>
                <div className="share-poster-frame">
                  <SharePoster record={record} />
                  {showDetails && <figcaption><span>{record.date} · {record.city || "城市待补"}</span><b>{record.title}</b></figcaption>}
                </div>
              </figure>
            ))}`, "share preview record map");

ts = replaceExact(ts, `function SharePoster({ record }: { record: EventRecord }) {
  const media = primaryMedia(record);
  const src = useCachedMediaSrc(media);
  const style = { "--poster-a": record.colors[0], "--poster-b": record.colors[1] } as CSSProperties;
  if (!src) return <span className="share-poster-fallback" style={style}>{record.title.slice(0, 4)}</span>;
  return <img src={src} alt={record.title} decoding="async" />;
}`, `function SharePoster({ record }: { record: EventRecord }) {
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
}`, "SharePoster component");

ts = replaceExact(ts, `function drawContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
  context.fillStyle = background;
  context.fillRect(x, y, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}`, `function drawContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
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
}`, "canvas contain renderer");

await writeFile(tsPath, ts);

const cssPath = "src/shareStudio.css";
let css = await readFile(cssPath, "utf8");

css = replaceExact(css, `.share-selection-grid button > img,
.share-selection-grid button > .share-poster-fallback {
  width: 42px;
  height: 56px;
  object-fit: contain;
  border-radius: 5px;
  background: #18201e;
}`, `.share-selection-grid button > .share-poster-image,
.share-selection-grid button > .share-poster-fallback {
  width: 42px;
  height: 56px;
  overflow: hidden;
  border-radius: 5px;
  background: #18201e;
}

.share-selection-grid .share-poster-backdrop { display: none; }
.share-selection-grid .share-poster-foreground { width: 100%; height: 100%; object-fit: contain; }`, "selection poster thumbnail");

css = replaceExact(css, `.share-preview-posters figure {
  position: relative;
  width: auto;
  max-width: 100%;
  height: 100%;
  aspect-ratio: 2 / 3;
  justify-self: center;
  margin: 0;
  overflow: hidden;
  border-radius: clamp(3px, 0.45vw, 8px);
  background: var(--share-surface);
  box-shadow: 0 7px 20px rgba(10, 32, 26, 0.16);
}

.share-preview-posters figure > img,
.share-preview-posters figure > .share-poster-fallback {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--share-surface);
}`, `.share-preview-posters figure {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  container-type: size;
  margin: 0;
  overflow: visible;
}

.share-poster-frame {
  position: relative;
  width: min(100cqw, calc(100cqh * 2 / 3));
  height: min(100cqh, calc(100cqw * 3 / 2));
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: clamp(3px, 0.45vw, 8px);
  background: var(--share-surface);
  box-shadow: 0 7px 20px rgba(10, 32, 26, 0.16);
}

.share-poster-image {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--share-surface);
}

.share-poster-backdrop,
.share-poster-foreground {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.share-poster-backdrop {
  inset: -8%;
  width: 116%;
  height: 116%;
  object-fit: cover;
  filter: blur(clamp(6px, 1vw, 14px)) brightness(0.7) saturate(0.86);
  transform: scale(1.04);
}

.share-poster-foreground {
  z-index: 1;
  object-fit: contain;
}

.share-poster-frame > .share-poster-fallback {
  width: 100%;
  height: 100%;
}`, "preview poster frame");

css = replaceExact(css, `.share-layout-dense .share-preview-posters { gap: clamp(2px, 0.3vw, 6px); }
.share-layout-dense .share-preview-posters figure { border-radius: 2px; box-shadow: none; }
.share-layout-catalog .share-preview-posters { gap: clamp(5px, 0.8vw, 14px); }
.share-layout-catalog .share-preview-posters figure { border: 2px solid color-mix(in srgb, var(--share-text) 42%, transparent); }
.share-layout-staggered .share-preview-posters { gap: clamp(6px, 1vw, 18px); }
.share-layout-staggered .share-preview-posters figure:nth-child(5n + 1) { transform: rotate(-1.3deg); }
.share-layout-staggered .share-preview-posters figure:nth-child(5n + 2) { transform: rotate(0.8deg); }
.share-layout-staggered .share-preview-posters figure:nth-child(5n + 3) { transform: rotate(-0.5deg); }
.share-layout-staggered .share-preview-posters figure:nth-child(5n + 4) { transform: rotate(1.2deg); }
.share-layout-staggered .share-preview-posters figure:nth-child(5n) { transform: rotate(-0.8deg); }`, `.share-layout-dense .share-preview-posters { gap: clamp(2px, 0.3vw, 6px); }
.share-layout-dense .share-poster-frame { border-radius: 2px; box-shadow: none; }
.share-layout-catalog .share-preview-posters { gap: clamp(5px, 0.8vw, 14px); }
.share-layout-catalog .share-poster-frame { border: 2px solid color-mix(in srgb, var(--share-text) 42%, transparent); }
.share-layout-staggered .share-preview-posters { gap: clamp(6px, 1vw, 18px); }
.share-layout-staggered figure:nth-child(5n + 1) .share-poster-frame { transform: rotate(-1.3deg); }
.share-layout-staggered figure:nth-child(5n + 2) .share-poster-frame { transform: rotate(0.8deg); }
.share-layout-staggered figure:nth-child(5n + 3) .share-poster-frame { transform: rotate(-0.5deg); }
.share-layout-staggered figure:nth-child(5n + 4) .share-poster-frame { transform: rotate(1.2deg); }
.share-layout-staggered figure:nth-child(5n) .share-poster-frame { transform: rotate(-0.8deg); }`, "layout frame styles");

await writeFile(cssPath, css);

const visualPath = "scripts/visual-audit.mjs";
let visual = await readFile(visualPath, "utf8");
visual = replaceExact(visual, `  const shareMedia = await page.locator(".share-preview-posters figure").evaluateAll((figures) => figures.map((figure) => {
    const rect = figure.getBoundingClientRect();
    const image = figure.querySelector("img");
    return {
      cellRatio: rect.height / rect.width,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
      naturalRatio: image && image.naturalWidth ? image.naturalHeight / image.naturalWidth : null,
    };
  }));
  if (!shareMedia.length || shareMedia.some(({ cellRatio, objectFit, naturalRatio }) => cellRatio <= 1.05 || objectFit !== "contain" || (naturalRatio !== null && naturalRatio <= 1))) {
    throw new Error(\`Share preview cropped or flattened portrait posters: \${JSON.stringify(shareMedia)}\`);
  }`, `  const shareMedia = await page.locator(".share-preview-posters figure").evaluateAll((figures) => figures.map((figure) => {
    const frame = figure.querySelector(".share-poster-frame");
    const image = figure.querySelector(".share-poster-foreground");
    const rect = frame?.getBoundingClientRect();
    return {
      frameRatio: rect ? rect.height / rect.width : 0,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
      naturalRatio: image && image.naturalWidth ? image.naturalHeight / image.naturalWidth : null,
    };
  }));
  if (!shareMedia.length || shareMedia.some(({ frameRatio, objectFit, naturalRatio }) => Math.abs(frameRatio - 1.5) > 0.08 || objectFit !== "contain" || (naturalRatio !== null && naturalRatio <= 1))) {
    throw new Error(\`Share preview cropped or flattened portrait posters: \${JSON.stringify(shareMedia)}\`);
  }`, "share preview visual assertion");
await writeFile(visualPath, visual);

console.log("Share preview poster frames and blurred export backgrounds applied.");
