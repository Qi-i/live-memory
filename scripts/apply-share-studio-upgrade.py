from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing patch target in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, block: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if marker in text:
        return
    p.write_text(text.rstrip() + "\n\n" + block.strip() + "\n", encoding="utf-8")


# --- Share Studio types and palette catalog ---
replace_once(
    "src/shareStudio.tsx",
    'export type ShareFormat = "landscape" | "portrait" | "square" | "long";\ntype ShareLayout = "wall" | "timeline" | "magazine" | "cities";\ntype SharePalette = "jade" | "midnight" | "paper" | "sunset";',
    'export type ShareFormat = "adaptive-landscape" | "adaptive-portrait" | "landscape" | "portrait" | "square" | "long";\ntype ShareLayout = "wall" | "timeline" | "magazine" | "cities";\ntype SharePalette = "jade" | "midnight" | "paper" | "sunset" | "graphite" | "mist" | "forest" | "champagne" | "plum" | "silver";',
)

old_palette_options = '''const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "jade", label: "翡翠绿" },
  { value: "midnight", label: "深海蓝" },
  { value: "paper", label: "极简白" },
  { value: "sunset", label: "暖砂金" },
];'''
new_palette_options = '''const paletteOptions: Array<{ value: SharePalette; label: string }> = [
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
];'''
replace_once("src/shareStudio.tsx", old_palette_options, new_palette_options)

old_palettes = '''const palettes: Record<SharePalette, PaletteDefinition> = {
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
};'''
new_palettes = '''const palettes: Record<SharePalette, PaletteDefinition> = {
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
};'''
replace_once("src/shareStudio.tsx", old_palettes, new_palettes)

# --- Compact paired controls and six format choices ---
replace_once(
    "src/shareStudio.tsx",
    '        <section className="share-control-group">\n          <strong>排序方式</strong>',
    '        <div className="share-control-compact-grid">\n        <section className="share-control-group">\n          <strong>排序方式</strong>',
)
replace_once(
    "src/shareStudio.tsx",
    '''        </section>

        {scope === "range" && (''',
    '''        </section>
        </div>

        {scope === "range" && (''',
)
replace_once(
    "src/shareStudio.tsx",
    '        <section className="share-control-group">\n          <strong>最多使用</strong>',
    '        <div className="share-control-compact-grid">\n        <section className="share-control-group">\n          <strong>最多使用</strong>',
)
old_format = '''        <section className="share-control-group">
          <strong>成图比例</strong>
          <div className="share-format-control">
            {(["portrait", "square", "landscape", "long"] as ShareFormat[]).map((item) => (
              <button className={format === item ? "is-active" : ""} key={item} type="button" onClick={() => setFormat(item)}>
                {item === "portrait" ? "竖版 4:5" : item === "square" ? "方形 1:1" : item === "landscape" ? "横版 16:9" : "手机长图"}
              </button>
            ))}
          </div>
        </section>'''
new_format = '''        <section className="share-control-group">
          <strong>成图比例 <small>智能尺寸会按海报数量自动计算</small></strong>
          <div className="share-format-control">
            {(["adaptive-landscape", "adaptive-portrait", "landscape", "portrait", "square", "long"] as ShareFormat[]).map((item) => (
              <button className={format === item ? "is-active" : ""} key={item} type="button" onClick={() => setFormat(item)}>
                {formatLabel(item)}
              </button>
            ))}
          </div>
        </section>
        </div>'''
replace_once("src/shareStudio.tsx", old_format, new_format)
replace_once(
    "src/shareStudio.tsx",
    '              {showBrand ? <BrandLockup compact inverse={palette === "midnight"} size={44} /> : null}',
    '              {showBrand ? <BrandLockup compact inverse={isDarkPalette(palette)} size={44} /> : null}',
)

# --- Adaptive wall renderer in preview and export ---
replace_once(
    "src/shareStudio.tsx",
    '  const slots = layout === "magazine" ? buildMagazineSlots(records, area, spec) : buildJustifiedSlots(records, area, spec);',
    '  const slots = layout === "magazine" ? buildMagazineSlots(records, area, spec) : isAdaptiveFormat(spec.format) ? buildAdaptiveWallSlots(records, area, spec) : buildJustifiedSlots(records, area, spec);',
)
replace_once(
    "src/shareStudio.tsx",
    '    const slots = options.layout === "magazine" ? buildMagazineSlots(options.records, area, spec) : buildJustifiedSlots(options.records, area, spec);',
    '    const slots = options.layout === "magazine" ? buildMagazineSlots(options.records, area, spec) : isAdaptiveFormat(spec.format) ? buildAdaptiveWallSlots(options.records, area, spec) : buildJustifiedSlots(options.records, area, spec);',
)
replace_once(
    "src/shareStudio.tsx",
    '  if (spec.format === "landscape") {',
    '  if (isLandscapeFormat(spec.format)) {',
)

insert_before_justified = '''function buildAdaptiveWallSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {
  if (!records.length) return [];
  const gap = spec.width >= 1500 ? 14 : 12;
  const landscape = spec.format === "adaptive-landscape";
  const chromeHeight = spec.height - area.height;
  const rowCount = chooseAdaptiveRowCount(records, area.width, gap, landscape, spec.width, chromeHeight);
  const { groups, heights, totalHeight } = measureAdaptiveRows(records, area.width, gap, rowCount);
  let y = area.y + Math.max(0, (area.height - totalHeight) / 2);
  const slots: PosterSlot[] = [];

  groups.forEach(([start, end], rowIndex) => {
    const height = heights[rowIndex];
    let x = area.x;
    for (let index = start; index < end; index += 1) {
      const isLast = index === end - 1;
      const width = isLast ? area.x + area.width - x : recordPosterRatio(records[index]) * height;
      slots.push({ record: records[index], rect: { x, y, width: Math.max(1, width), height } });
      x += width + gap;
    }
    y += height + gap;
  });
  return slots;
}

function measureAdaptiveRows(records: EventRecord[], width: number, gap: number, rowCount: number) {
  const groups = partitionBalanced(records.length, rowCount);
  const heights = groups.map(([start, end]) => {
    const ratioSum = records.slice(start, end).reduce((sum, record) => sum + recordPosterRatio(record), 0);
    return (width - gap * Math.max(0, end - start - 1)) / Math.max(0.01, ratioSum);
  });
  const totalHeight = heights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, rowCount - 1);
  return { groups, heights, totalHeight };
}

function chooseAdaptiveRowCount(
  records: EventRecord[],
  width: number,
  gap: number,
  landscape: boolean,
  canvasWidth: number,
  chromeHeight: number,
) {
  if (!records.length) return 1;
  const targetAspect = landscape ? 1.55 : 0.72;
  const maxRows = Math.min(records.length, landscape ? 7 : 11);
  let bestRows = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let rows = 1; rows <= maxRows; rows += 1) {
    const measured = measureAdaptiveRows(records, width, gap, rows);
    const canvasAspect = canvasWidth / Math.max(1, measured.totalHeight + chromeHeight);
    const orientationPenalty = landscape
      ? (canvasAspect < 1.12 ? 4 + (1.12 - canvasAspect) * 4 : 0)
      : (canvasAspect > 0.92 ? 4 + (canvasAspect - 0.92) * 4 : 0);
    const occupiedArea = measured.groups.reduce((sum, [start, end], index) => {
      const ratioSum = records.slice(start, end).reduce((rowSum, record) => rowSum + recordPosterRatio(record), 0);
      return sum + ratioSum * measured.heights[index] * measured.heights[index];
    }, 0);
    const fillRatio = occupiedArea / Math.max(1, width * measured.totalHeight);
    const averageHeight = measured.heights.reduce((sum, value) => sum + value, 0) / measured.heights.length;
    const readabilityPenalty = averageHeight < 125 ? (125 - averageHeight) / 125 : 0;
    const score = Math.abs(Math.log(Math.max(0.01, canvasAspect / targetAspect))) + orientationPenalty + readabilityPenalty * 0.5 + (1 - fillRatio) * 0.08;
    if (score < bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }
  return bestRows;
}

'''
replace_once(
    "src/shareStudio.tsx",
    'function buildJustifiedSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {',
    insert_before_justified + 'function buildJustifiedSlots(records: EventRecord[], area: Rect, spec: CanvasSpec): PosterSlot[] {',
)

# --- Adaptive canvas sizing helpers ---
old_canvas_spec = '''function getCanvasSpec(format: ShareFormat, count: number, layout: ShareLayout, records: EventRecord[]): CanvasSpec {
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
}'''
new_canvas_spec = '''function formatLabel(format: ShareFormat) {
  if (format === "adaptive-landscape") return "智能横版";
  if (format === "adaptive-portrait") return "智能竖版";
  if (format === "portrait") return "竖版 4:5";
  if (format === "square") return "方形 1:1";
  if (format === "landscape") return "横版 16:9";
  return "手机长图";
}

function isAdaptiveFormat(format: ShareFormat) {
  return format === "adaptive-landscape" || format === "adaptive-portrait";
}

function isLandscapeFormat(format: ShareFormat) {
  return format === "landscape" || format === "adaptive-landscape";
}

function isDarkPalette(palette: SharePalette) {
  return palette === "midnight" || palette === "graphite" || palette === "forest" || palette === "plum";
}

function getAdaptiveCanvasSpec(format: "adaptive-landscape" | "adaptive-portrait", records: EventRecord[], layout: ShareLayout): CanvasSpec {
  const landscape = format === "adaptive-landscape";
  const width = landscape ? 1600 : 1200;
  const padding = landscape ? 48 : 44;
  const headerHeight = landscape ? 112 : 124;
  const footerHeight = 54;
  const chromeHeight = padding * 2 + headerHeight + footerHeight;
  if (!records.length) return { width, height: landscape ? 900 : 1500, padding, headerHeight, footerHeight, format };

  if (layout === "wall") {
    const gap = landscape ? 14 : 12;
    const contentWidth = width - padding * 2;
    const rows = chooseAdaptiveRowCount(records, contentWidth, gap, landscape, width, chromeHeight);
    const measured = measureAdaptiveRows(records, contentWidth, gap, rows);
    const naturalHeight = Math.round(chromeHeight + measured.totalHeight);
    const minHeight = landscape ? 820 : 1500;
    return { width, height: Math.max(minHeight, naturalHeight), padding, headerHeight, footerHeight, format };
  }

  const groupCount = layout === "timeline" ? groupByYear(records).length : layout === "cities" ? groupByCity(records).length : 0;
  const contentHeight = layout === "timeline"
    ? Math.max(landscape ? 680 : 1080, groupCount * (landscape ? 210 : 275))
    : layout === "cities"
      ? Math.max(landscape ? 700 : 1120, groupCount * (landscape ? 185 : 235))
      : Math.max(landscape ? 700 : 1120, Math.ceil(records.length / (landscape ? 6 : 4)) * (landscape ? 230 : 275));
  return { width, height: chromeHeight + contentHeight, padding, headerHeight, footerHeight, format };
}

function getCanvasSpec(format: ShareFormat, count: number, layout: ShareLayout, records: EventRecord[]): CanvasSpec {
  if (format === "adaptive-landscape" || format === "adaptive-portrait") return getAdaptiveCanvasSpec(format, records, layout);
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
}'''
replace_once("src/shareStudio.tsx", old_canvas_spec, new_canvas_spec)
replace_once(
    "src/shareStudio.tsx",
    '  context.font = `900 ${Math.round(spec.width * (options.format === "landscape" ? 0.037 : 0.049))}px system-ui, sans-serif`;',
    '  context.font = `900 ${Math.round(spec.width * (isLandscapeFormat(options.format) ? 0.037 : 0.049))}px system-ui, sans-serif`;',
)

# --- Cover crop in DOM and canvas export ---
replace_once(
    "src/shareStudio.tsx",
    '  if (image) drawContain(context, image, slot.x, slot.y, slot.width, slot.height, palette.surface);',
    '  if (image) drawCover(context, image, slot.x, slot.y, slot.width, slot.height, palette.surface);',
)
old_draw_contain = '''function drawContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
  context.fillStyle = background;
  context.fillRect(x, y, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}'''
new_draw_cover = '''function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, background: string) {
  context.fillStyle = background;
  context.fillRect(x, y, width, height);
  const overscan = 1.025;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * overscan;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}'''
replace_once("src/shareStudio.tsx", old_draw_contain, new_draw_cover)

# --- Default to smart landscape ---
replace_once(
    "src/AppRoot.tsx",
    '  const [shareFormat, setShareFormat] = useState<ShareFormat>("portrait");',
    '  const [shareFormat, setShareFormat] = useState<ShareFormat>("adaptive-landscape");',
)

# --- Share Studio CSS density, swatches, themes, crop ---
css = Path("src/shareStudio.css").read_text(encoding="utf-8")
css = css.replace('grid-template-columns: minmax(360px, 420px) minmax(0, 1fr);', 'grid-template-columns: minmax(350px, 400px) minmax(0, 1fr);', 1)
css = css.replace('  gap: 14px;\n  padding: 18px 20px 22px;', '  gap: 8px;\n  padding: 12px 14px 14px;', 1)
css = css.replace('.share-intro-copy { display: grid; gap: 4px; }', '.share-intro-copy { display: grid; gap: 2px; }', 1)
css = css.replace('.share-intro-copy h2 { margin: 0; font-size: 25px;', '.share-intro-copy h2 { margin: 0; font-size: 20px;', 1)
css = css.replace('.share-intro-copy p { margin: 0;', '.share-intro-copy p { display: none; margin: 0;', 1)
css = css.replace('  padding: 12px 13px;', '  padding: 8px 10px;', 1)
css = css.replace('.share-studio-summary strong { grid-row: 1 / span 2; color: #0b7765; font-size: 30px;', '.share-studio-summary strong { grid-row: 1 / span 2; color: #0b7765; font-size: 25px;', 1)
css = css.replace('.share-control-group { display: grid; gap: 7px; }', '.share-control-group { display: grid; gap: 4px; }', 1)
css = css.replace('.share-headline-input { min-height: 42px;', '.share-headline-input { min-height: 34px;', 1)
css = css.replace('.share-category-control { grid-template-columns: repeat(3, minmax(0, 1fr)); }', '.share-category-control { grid-template-columns: repeat(6, minmax(0, 1fr)); }', 1)
css = css.replace('.share-format-control,\n.share-count-control { grid-template-columns: repeat(4, minmax(0, 1fr)); }', '.share-format-control { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n.share-count-control { grid-template-columns: repeat(4, minmax(0, 1fr)); }', 1)
css = css.replace('  min-height: 35px;', '  min-height: 29px;', 1)
css = css.replace('  grid-template-columns: 34px minmax(0, 1fr);\n  min-height: 47px;', '  grid-template-columns: 24px minmax(0, 1fr);\n  min-height: 36px;', 1)
css = css.replace('.share-layout-control { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }', '.share-layout-control { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }', 1)
css = css.replace('  grid-template-columns: 30px minmax(0, 1fr);\n  min-height: 72px;', '  grid-template-columns: 1fr;\n  min-height: 50px;', 1)
css = css.replace('  text-align: left;', '  text-align: center;', 1)
css = css.replace('.share-layout-control button span { display: grid; gap: 3px; }', '.share-layout-control button span { display: grid; gap: 1px; }', 1)
css = css.replace('.share-layout-control button small { color: #858d89; font-size: 8px; line-height: 1.3; }', '.share-layout-control button small { display: none; color: #858d89; font-size: 8px; line-height: 1.3; }', 1)
css = css.replace('.share-palette-control { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }', '.share-palette-control { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }', 1)
css = css.replace('.share-palette-control button { display: grid; min-height: 56px;', '.share-palette-control button { display: grid; min-height: 40px;', 1)
css = css.replace('.share-palette-control button i { width: 31px; height: 22px;', '.share-palette-control button i { width: 28px; height: 16px;', 1)
css = css.replace('.share-switches label { display: grid; grid-template-columns: 17px minmax(0, 1fr); gap: 7px; align-items: start; padding: 9px;', '.share-switches label { display: grid; grid-template-columns: 15px minmax(0, 1fr); gap: 5px; align-items: center; padding: 6px;', 1)
css = css.replace('.share-switches small { color: #7a827f; font-size: 8px; line-height: 1.35; }', '.share-switches small { display: none; color: #7a827f; font-size: 8px; line-height: 1.35; }', 1)
css = css.replace('.share-export-button { display: inline-flex; min-height: 50px;', '.share-export-button { display: inline-flex; min-height: 42px;', 1)
old_poster_css = '''.share-poster-foreground,
.share-poster-fallback { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }
.share-poster-fallback { display: grid; place-items: center; padding: 8px; color: white; background: linear-gradient(135deg, var(--poster-a, #172229), var(--poster-b, #47645d)); font-size: 16px; font-weight: 950; text-align: center; }'''
new_poster_css = '''.share-poster-foreground { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; transform: scale(1.025); }
.share-poster-fallback { display: grid; width: 100%; height: 100%; place-items: center; padding: 8px; color: white; background: linear-gradient(135deg, var(--poster-a, #172229), var(--poster-b, #47645d)); font-size: 16px; font-weight: 950; text-align: center; }'''
if old_poster_css not in css:
    raise SystemExit("missing share poster CSS target")
css = css.replace(old_poster_css, new_poster_css, 1)
Path("src/shareStudio.css").write_text(css, encoding="utf-8")

append_once("src/shareStudio.css", ".share-control-compact-grid", '''
.share-control-compact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  align-items: end;
}

.share-theme-graphite .share-preview { --share-bg-a: #101416; --share-bg-b: #303638; --share-surface: #1c2224; --share-text: #f4f5f2; --share-muted: #aab2ae; --share-accent: #91b7ad; --share-accent-soft: #d4dcc8; }
.share-theme-mist .share-preview { --share-bg-a: #e5ecee; --share-bg-b: #a7b7bd; --share-surface: #f7f9f9; --share-text: #172126; --share-muted: #65767d; --share-accent: #557d86; --share-accent-soft: #d5e8e4; }
.share-theme-forest .share-preview { --share-bg-a: #0c211b; --share-bg-b: #36574a; --share-surface: #17342b; --share-text: #f4f7f1; --share-muted: #a8bbb3; --share-accent: #79c5aa; --share-accent-soft: #d9d2a0; }
.share-theme-champagne .share-preview { --share-bg-a: #f5efe5; --share-bg-b: #c9baa4; --share-surface: #fffaf2; --share-text: #2d2822; --share-muted: #7b6e60; --share-accent: #8b7150; --share-accent-soft: #e0c88d; }
.share-theme-plum .share-preview { --share-bg-a: #19151d; --share-bg-b: #4c4050; --share-surface: #29232e; --share-text: #faf7fb; --share-muted: #b6aabb; --share-accent: #bba8c0; --share-accent-soft: #d8d0bd; }
.share-theme-silver .share-preview { --share-bg-a: #eef1f2; --share-bg-b: #bcc5ca; --share-surface: #fbfcfc; --share-text: #1c2428; --share-muted: #69777e; --share-accent: #617d89; --share-accent-soft: #d6e3df; }
.share-theme-graphite .share-preview > header .brand-lockup,
.share-theme-forest .share-preview > header .brand-lockup,
.share-theme-plum .share-preview > header .brand-lockup { color: #f7fffb; }

.share-palette-control button[data-palette="graphite"] i { background: linear-gradient(135deg, #101416, #303638); }
.share-palette-control button[data-palette="mist"] i { background: linear-gradient(135deg, #e5ecee, #a7b7bd); }
.share-palette-control button[data-palette="forest"] i { background: linear-gradient(135deg, #0c211b, #36574a); }
.share-palette-control button[data-palette="champagne"] i { background: linear-gradient(135deg, #f5efe5, #c9baa4); }
.share-palette-control button[data-palette="plum"] i { background: linear-gradient(135deg, #19151d, #4c4050); }
.share-palette-control button[data-palette="silver"] i { background: linear-gradient(135deg, #eef1f2, #bcc5ca); }

@media (max-height: 820px) and (min-width: 861px) {
  .share-studio-panel { gap: 6px; padding-block: 9px; }
  .share-studio-heading .brand-lockup { transform: scale(.9); transform-origin: left center; }
  .share-intro-copy > span { display: none; }
  .share-studio-summary { padding-block: 6px; }
  .share-layout-control button { min-height: 44px; }
  .share-palette-control button { min-height: 34px; }
}
''')

# --- Map API guidance and links ---
old_map = '''          <section className="settings-module compact-settings-v2">
            <ModuleHeader eyebrow="地图" title="城市与场馆足迹" description="地图密钥只在启用真实在线地图时需要。" />
            <label>地图来源<select value={draft.map.provider} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, provider: event.target.value as AppSettings["map"]["provider"] } })}><option value="none">统计式足迹图</option><option value="amap">高德地图</option><option value="baidu">百度地图</option></select></label>
            {draft.map.provider === "amap" && <><label>高德 Key<input type="password" value={draft.map.amapKey} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapKey: event.target.value } })} /></label><label>安全密钥<input type="password" value={draft.map.amapSecurityCode} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapSecurityCode: event.target.value } })} /></label></>}
            {draft.map.provider === "baidu" && <label>百度 AK<input type="password" value={draft.map.baiduAk} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, baiduAk: event.target.value } })} /></label>}
            <button className="button primary" type="button" onClick={() => void onSave(draft)}><MapIcon />保存地图设置</button>
          </section>'''
new_map = '''          <section className="settings-module compact-settings-v2">
            <ModuleHeader eyebrow="地图" title="城市与场馆足迹" description="统计式足迹图无需密钥；启用在线地图时按下方指引申请浏览器端 API。" />
            <label title="统计式足迹图无需 API；高德或百度在线地图需要各自的浏览器端密钥。">地图来源<select value={draft.map.provider} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, provider: event.target.value as AppSettings["map"]["provider"] } })}><option value="none">统计式足迹图（无需 API）</option><option value="amap">高德地图</option><option value="baidu">百度地图</option></select></label>
            {draft.map.provider === "amap" && <><label title="在高德开放平台创建 Web端（JS API）Key。">高德 Key<input type="password" value={draft.map.amapKey} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapKey: event.target.value } })} /></label><label title="高德 JS API 2.0 新 Key 通常需要同时配置安全密钥。">安全密钥<input type="password" value={draft.map.amapSecurityCode} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapSecurityCode: event.target.value } })} /></label></>}
            {draft.map.provider === "baidu" && <label title="在百度地图开放平台创建浏览器端应用并获取 AK。">百度 AK<input type="password" value={draft.map.baiduAk} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, baiduAk: event.target.value } })} /></label>}
            <div className="map-api-help-v2" title="鼠标悬停在地图来源、Key、AK 输入项上也能看到对应说明。">
              <strong>地图 API 获取说明</strong>
              <span>只想看城市统计可保持“统计式足迹图”；在线底图再申请相应浏览器端密钥。</span>
              <div>
                <a href="https://lbs.amap.com/api/javascript-api-v2/prerequisites" target="_blank" rel="noreferrer">获取高德 Key <ExternalLink /></a>
                <a href="https://lbsyun.baidu.com/index.php?title=jspopularGL1.0/guide/getkey" target="_blank" rel="noreferrer">获取百度 AK <ExternalLink /></a>
              </div>
            </div>
            <button className="button primary" type="button" onClick={() => void onSave(draft)}><MapIcon />保存地图设置</button>
          </section>'''
replace_once("src/settingsPage.tsx", old_map, new_map)
append_once("src/settingsPage.css", ".map-api-help-v2", '''
.map-api-help-v2 {
  display: grid;
  gap: 6px;
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--experience-accent-2) 26%, var(--experience-border));
  border-radius: 9px;
  background: color-mix(in srgb, var(--experience-accent) 7%, var(--experience-surface-solid));
}
.map-api-help-v2 > strong { font-size: 11px; }
.map-api-help-v2 > span { color: var(--experience-muted); font-size: 10px; font-weight: 760; line-height: 1.45; }
.map-api-help-v2 > div { display: flex; flex-wrap: wrap; gap: 6px; }
.map-api-help-v2 a { display: inline-flex; align-items: center; gap: 4px; color: var(--experience-text); font-size: 10px; font-weight: 900; text-decoration: none; }
.map-api-help-v2 a:hover { color: var(--experience-accent-2); text-decoration: underline; }
.map-api-help-v2 svg { width: 12px; height: 12px; }
''')

# --- Update existing contracts to the new behavior ---
replace_once(
    "scripts/run-tests.mjs",
    '  assert.match(shareStudio, /ShareFormat = "landscape" \\| "portrait" \\| "square" \\| "long"/);',
    '  assert.match(shareStudio, /ShareFormat = "adaptive-landscape" \\| "adaptive-portrait" \\| "landscape" \\| "portrait" \\| "square" \\| "long"/);',
)
replace_once("scripts/run-tests.mjs", '  assert.match(shareStudioCss, /object-fit:\\s*contain/);', '  assert.match(shareStudioCss, /object-fit:\\s*cover/);')
replace_once("scripts/run-tests.mjs", '  assert.match(shareStudio, /drawContain/);', '  assert.match(shareStudio, /drawCover/);')

replace_once(
    "scripts/v5-layout-contracts.mjs",
    'assert.match(appRoot, /useState<ShareFormat>\\("portrait"\\)/, "Share studio should open in portrait format");',
    'assert.match(appRoot, /useState<ShareFormat>\\("adaptive-landscape"\\)/, "Share studio should open in smart landscape format");',
)
replace_once("scripts/v5-layout-contracts.mjs", 'assert.match(studio, /spec\\.format === "landscape"/);', 'assert.match(studio, /isLandscapeFormat\\(spec\\.format\\)/);')
replace_once("scripts/v5-layout-contracts.mjs", 'assert.match(studio, /drawContain/);', 'assert.match(studio, /drawCover/);')
replace_once("scripts/v5-layout-contracts.mjs", 'assert.match(studioCss, /share-poster-foreground,[\\s\\S]*object-fit:\\s*contain/);', 'assert.match(studioCss, /share-poster-foreground[\\s\\S]*object-fit:\\s*cover/);')

# --- Visual audit: cover crop, compact default panel, adaptive orientation/fill ---
replace_once(
    "scripts/visual-audit.mjs",
    '''    if (poster.objectFit !== "contain" && poster.objectFit !== "fallback") {
      throw new Error(`${label} poster ${index + 1} is cropped with object-fit ${poster.objectFit}`);
    }''',
    '''    if (poster.objectFit !== "cover" && poster.objectFit !== "fallback") {
      throw new Error(`${label} poster ${index + 1} does not fill its frame with object-fit ${poster.objectFit}`);
    }''',
)
needle = '''  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });'''
replacement = '''  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  const activeFormat = await page.locator(".share-format-control button.is-active").innerText();
  if (!activeFormat.includes("智能横版")) throw new Error(`Share studio did not open in smart landscape mode: ${activeFormat}`);
  const panelDensity = await page.locator(".share-studio-panel").evaluate((panel) => ({ scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight }));
  if (panelDensity.scrollHeight > panelDensity.clientHeight + 4) throw new Error(`Default share controls still require scrolling: ${JSON.stringify(panelDensity)}`);
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });'''
replace_once("scripts/visual-audit.mjs", needle, replacement)
replace_once(
    "scripts/visual-audit.mjs",
    '  if (wallFill < 0.5) throw new Error(`Wall layout leaves too much empty space: ${wallFill.toFixed(3)}`);',
    '  if (wallFill < 0.72) throw new Error(`Adaptive wall layout leaves too much empty space: ${wallFill.toFixed(3)}`);',
)
orientation_probe = '''  await page.screenshot({ path: `${outputDir}/06-share-wall-fit.png`, fullPage: true });

  const fitText = await page.locator(".share-preview-toolbar strong").textContent();'''
orientation_replacement = '''  await page.screenshot({ path: `${outputDir}/06-share-wall-fit.png`, fullPage: true });

  await page.locator(".share-format-control button").filter({ hasText: "智能竖版" }).click();
  await page.waitForTimeout(120);
  const portraitSmart = await page.locator(".share-preview").boundingBox();
  if (!portraitSmart || portraitSmart.height <= portraitSmart.width) throw new Error(`Smart portrait did not produce a portrait canvas: ${JSON.stringify(portraitSmart)}`);
  await page.locator(".share-format-control button").filter({ hasText: "智能横版" }).click();
  await page.waitForTimeout(120);
  const landscapeSmart = await page.locator(".share-preview").boundingBox();
  if (!landscapeSmart || landscapeSmart.width <= landscapeSmart.height) throw new Error(`Smart landscape did not produce a landscape canvas: ${JSON.stringify(landscapeSmart)}`);

  const fitText = await page.locator(".share-preview-toolbar strong").textContent();'''
replace_once("scripts/visual-audit.mjs", orientation_probe, orientation_replacement)

print("share studio upgrade patches applied")
