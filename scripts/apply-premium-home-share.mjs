import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Pattern not found: ${label}`);
  return source.replace(from, to);
}

function replaceRegex(source, pattern, to, label) {
  if (!pattern.test(source)) throw new Error(`Pattern not found: ${label}`);
  return source.replace(pattern, to);
}

await patch("src/archive.tsx", (source) => {
  source = replaceOnce(source, `      <header className="archive-masthead">
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
      </header>`, `      <header className="archive-masthead">
        <div className="archive-masthead-copy">
          <span>LIVE MEMORY · 我的演出档案</span>
          <h2>每一场现场，<br />都是独一无二的记忆。</h2>
          <p>把看过的演出、留下的票根和走过的城市，整理成一份会继续生长的个人档案。</p>
          <div className="archive-masthead-actions">
            <button type="button" onClick={() => document.querySelector(".archive-command")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Archive />浏览全部档案</button>
            <button type="button" onClick={() => setShareMode(true)}><Share2 />制作分享图</button>
          </div>
          <div className="archive-masthead-stats" aria-label="演出记录摘要">
            <strong>{records.length}<span>全部记录</span></strong>
            <strong>{records.filter((record) => record.status === "watched").length}<span>已经看过</span></strong>
            <strong>{new Set(records.map((record) => record.city).filter(Boolean)).size}<span>到访城市</span></strong>
          </div>
        </div>
        <ArchiveHighlights records={records} onOpen={onOpen} />
      </header>`, "archive masthead markup");

  source = replaceRegex(source, /function ArchiveHighlights\([\s\S]*?\n}\n\nfunction ArchiveRenderer/, `function ArchiveHighlights({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const highlights = records.filter((record) => primaryMedia(record)).slice(0, 6);
  const featured = highlights[0];
  if (!highlights.length) return <div className="archive-highlight-empty"><span>把第一张演出海报放进来</span><small>这里会自动生成你的精选现场</small></div>;
  return (
    <div className="archive-highlights" aria-label="精选演出海报">
      <span className="archive-highlight-orbit" aria-hidden="true" />
      <div className="archive-highlight-stack">
        {highlights.map((record, index) => (
          <button className={\`archive-highlight-card archive-highlight-card-${index + 1}\`} key={record.id} type="button" onClick={() => onOpen(record)}>
            <RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 4)} />
            <span><b>{record.city || categoryLabels[record.category]}</b><small>{record.date.slice(0, 4)}</small></span>
          </button>
        ))}
      </div>
      {featured && (
        <button className="archive-highlight-feature" type="button" onClick={() => onOpen(featured)}>
          <span>最近收录</span>
          <strong>{featured.title}</strong>
          <small>{featured.date} · {featured.city || featured.venue || "演出记录"}</small>
        </button>
      )}
    </div>
  );
}

function ArchiveRenderer`, "archive highlights component");
  return source;
});

const heroCss = `.archive-masthead {
  position: relative;
  display: grid;
  grid-template-columns: minmax(360px, 0.86fr) minmax(520px, 1.14fr);
  min-height: 410px;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(circle at 78% 12%, color-mix(in srgb, var(--experience-accent) 30%, transparent), transparent 24%),
    radial-gradient(circle at 54% 86%, color-mix(in srgb, var(--experience-accent-2) 20%, transparent), transparent 30%),
    linear-gradient(135deg, color-mix(in srgb, var(--experience-accent) 11%, var(--experience-surface-solid)), var(--experience-surface-solid) 46%, color-mix(in srgb, var(--experience-accent-2) 12%, var(--experience-surface-solid)));
}

.archive-masthead::before {
  content: "";
  position: absolute;
  right: -7%;
  bottom: -44%;
  width: 68%;
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--experience-accent-2) 22%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 0 46px color-mix(in srgb, var(--experience-accent-2) 6%, transparent),
    0 0 0 94px color-mix(in srgb, var(--experience-accent) 5%, transparent);
  pointer-events: none;
}

.archive-masthead::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: 0.22;
  background-image: linear-gradient(110deg, transparent 0 47%, color-mix(in srgb, var(--experience-accent-2) 12%, transparent) 48%, transparent 49% 100%);
  background-size: 220px 100%;
  pointer-events: none;
}

.archive-masthead-copy {
  position: relative;
  z-index: 3;
  display: grid;
  align-content: center;
  padding: clamp(30px, 4vw, 56px);
}

.archive-masthead-copy > span,
.archive-result-strip em,
.archive-poster-copy > div span,
.showcase-card > div > span,
.archive-ticket section > span,
.archive-timeline section em,
.venue-ranking header > span {
  color: #108879;
  font-size: 11px;
  font-weight: 950;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.archive-masthead h2 {
  max-width: 700px;
  margin: 12px 0 14px;
  font-size: clamp(40px, 4.4vw, 66px);
  line-height: 1.02;
  letter-spacing: -0.065em;
}

.archive-masthead p {
  max-width: 590px;
  margin: 0;
  color: var(--experience-muted);
  font-size: 15px;
  font-weight: 780;
  line-height: 1.72;
}

.archive-masthead-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

.archive-masthead-actions button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border: 1px solid var(--experience-border);
  border-radius: 12px;
  color: var(--experience-text);
  background: color-mix(in srgb, var(--experience-surface-solid) 82%, transparent);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--experience-text) 8%, transparent);
  font: inherit;
  font-size: 12px;
  font-weight: 920;
  cursor: pointer;
  backdrop-filter: blur(14px);
}

.archive-masthead-actions button:first-child {
  border-color: transparent;
  color: #111318;
  background: linear-gradient(135deg, var(--experience-accent), color-mix(in srgb, var(--experience-accent) 68%, #94ebff));
}

.archive-masthead-actions button:hover { transform: translateY(-2px); }
.archive-masthead-actions svg { width: 16px; height: 16px; }

.archive-masthead-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-top: 28px;
}

.archive-masthead-stats strong {
  display: grid;
  grid-template-columns: auto auto;
  gap: 7px;
  align-items: baseline;
  font-size: 22px;
  letter-spacing: -0.04em;
}

.archive-masthead-stats strong + strong {
  padding-left: 18px;
  border-left: 1px solid var(--experience-border);
}

.archive-masthead-stats span {
  color: var(--experience-muted);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0;
}

.archive-highlights {
  position: relative;
  z-index: 2;
  min-height: 410px;
  overflow: hidden;
  background:
    radial-gradient(circle at 46% 42%, color-mix(in srgb, var(--experience-accent) 32%, transparent), transparent 30%),
    linear-gradient(150deg, color-mix(in srgb, var(--experience-surface-solid) 8%, transparent), color-mix(in srgb, var(--experience-accent-2) 8%, transparent));
}

.archive-highlights::after {
  content: "";
  position: absolute;
  right: 8%;
  bottom: 8%;
  left: 4%;
  height: 56px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--experience-text) 18%, transparent);
  filter: blur(26px);
  transform: perspective(400px) rotateX(72deg);
  pointer-events: none;
}

.archive-highlight-orbit {
  position: absolute;
  top: 14%;
  left: 25%;
  width: 46%;
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--experience-accent) 52%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 0 34px color-mix(in srgb, var(--experience-accent) 8%, transparent),
    0 0 0 72px color-mix(in srgb, var(--experience-accent-2) 5%, transparent);
  opacity: 0.75;
}

.archive-highlight-stack {
  position: absolute;
  inset: 18px 18px 22px 6px;
  perspective: 1100px;
}

.archive-highlight-card {
  position: absolute;
  z-index: 1;
  width: 27%;
  height: 68%;
  padding: 0;
  overflow: hidden;
  border: 5px solid color-mix(in srgb, var(--experience-surface-solid) 90%, white);
  border-radius: 18px;
  color: white;
  background: #172126;
  box-shadow: 0 24px 56px rgba(25, 46, 44, 0.24);
  cursor: pointer;
  transform-origin: 50% 100%;
  transition: transform 180ms ease, filter 180ms ease, box-shadow 180ms ease;
}

.archive-highlight-card:hover {
  z-index: 8;
  filter: saturate(1.06);
  box-shadow: 0 30px 70px rgba(25, 46, 44, 0.32);
}

.archive-highlight-card-1 { top: 5%; left: 33%; z-index: 6; width: 34%; height: 82%; transform: rotate(-1deg) translateZ(70px); }
.archive-highlight-card-2 { top: 18%; left: 9%; z-index: 3; transform: rotate(-8deg) translateZ(10px); }
.archive-highlight-card-3 { top: 16%; left: 62%; z-index: 4; width: 26%; height: 70%; transform: rotate(7deg) translateZ(24px); }
.archive-highlight-card-4 { top: 8%; left: 75%; z-index: 2; width: 22%; height: 61%; transform: rotate(11deg); }
.archive-highlight-card-5 { top: 29%; left: 0; z-index: 1; width: 22%; height: 55%; transform: rotate(-11deg); }
.archive-highlight-card-6 { top: 30%; left: 78%; z-index: 1; width: 20%; height: 52%; transform: rotate(13deg); }
.archive-highlight-card-1:hover { transform: rotate(-1deg) translateY(-8px) translateZ(96px); }
.archive-highlight-card-2:hover { transform: rotate(-6deg) translateY(-8px) translateZ(50px); }
.archive-highlight-card-3:hover { transform: rotate(5deg) translateY(-8px) translateZ(54px); }
.archive-highlight-card-4:hover,
.archive-highlight-card-5:hover,
.archive-highlight-card-6:hover { transform: rotate(0) translateY(-8px) translateZ(46px); }

.archive-highlight-card img,
.archive-highlight-card > .record-media-fallback {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.archive-highlight-card > span:last-child {
  position: absolute;
  right: 9px;
  bottom: 9px;
  left: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  color: #111318;
  background: color-mix(in srgb, var(--experience-accent) 92%, white);
  box-shadow: 0 7px 18px rgba(0, 0, 0, 0.18);
}

.archive-highlight-card > span b {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-highlight-card > span small { font-size: 9px; font-weight: 900; }

.archive-highlight-feature {
  position: absolute;
  right: 22px;
  bottom: 20px;
  z-index: 9;
  display: grid;
  max-width: 270px;
  gap: 3px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--experience-border) 80%, transparent);
  border-radius: 14px;
  color: var(--experience-text);
  text-align: left;
  background: color-mix(in srgb, var(--experience-surface-solid) 76%, transparent);
  box-shadow: 0 12px 34px color-mix(in srgb, var(--experience-text) 12%, transparent);
  backdrop-filter: blur(18px);
  cursor: pointer;
}

.archive-highlight-feature span { color: #108879; font-size: 9px; font-weight: 950; letter-spacing: 0.12em; }
.archive-highlight-feature strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.archive-highlight-feature small { overflow: hidden; color: var(--experience-muted); font-size: 9px; font-weight: 780; text-overflow: ellipsis; white-space: nowrap; }

.archive-highlight-empty {
  display: grid;
  min-height: 410px;
  place-items: center;
  align-content: center;
  gap: 6px;
  padding: 24px;
  color: var(--experience-text);
  text-align: center;
  background: radial-gradient(circle, color-mix(in srgb, var(--experience-accent) 22%, transparent), transparent 56%);
}

.archive-highlight-empty span { font-size: 18px; font-weight: 950; }
.archive-highlight-empty small { color: var(--experience-muted); font-weight: 780; }
`;

await patch("src/archive.css", (source) => {
  source = replaceRegex(source, /\.archive-masthead \{[\s\S]*?\.archive-highlight-empty \{[\s\S]*?\n\}/, heroCss.trim(), "archive hero styles");
  source = replaceRegex(source, /\n\.share-stage \{[\s\S]*?\.share-canvas-square \.share-poster-wall \.share-poster-1 \{ grid-column: span 6; \}\n/, "\n", "remove legacy share canvas styles");
  source = replaceOnce(source, `@media (max-width: 1020px) {
  .archive-masthead { grid-template-columns: 1fr; min-height: 190px; }
  .archive-highlights { display: none; }`, `@media (max-width: 1020px) {
  .archive-masthead { grid-template-columns: 1fr; min-height: 0; }
  .archive-highlights { min-height: 330px; border-top: 1px solid var(--experience-border); }
  .archive-highlight-stack { inset: 10px 8px 18px; }
  .archive-highlight-card-1 { left: 35%; width: 30%; }
  .archive-highlight-feature { right: 16px; bottom: 14px; }`, "tablet masthead styles");
  source = replaceOnce(source, `@media (max-width: 720px) {
  .archive-page { gap: 10px; }
  .archive-masthead { min-height: 150px; }
  .archive-masthead > div:first-child { padding: 18px; }
  .archive-masthead h2 { font-size: 35px; }
  .archive-masthead p { display: none; }`, `@media (max-width: 720px) {
  .archive-page { gap: 10px; }
  .archive-masthead { min-height: 0; border-radius: 18px; }
  .archive-masthead-copy { padding: 22px 18px 18px; }
  .archive-masthead h2 { margin-top: 9px; font-size: clamp(33px, 10vw, 46px); }
  .archive-masthead p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 12px; }
  .archive-masthead-actions { margin-top: 16px; }
  .archive-masthead-actions button { min-height: 40px; padding: 0 12px; }
  .archive-masthead-stats { gap: 10px; margin-top: 18px; }
  .archive-masthead-stats strong { font-size: 18px; }
  .archive-masthead-stats strong + strong { padding-left: 10px; }
  .archive-highlights { min-height: 245px; }
  .archive-highlight-card { border-width: 3px; border-radius: 12px; }
  .archive-highlight-card-1 { top: 4%; left: 35%; width: 31%; height: 82%; }
  .archive-highlight-card-2 { top: 19%; left: 7%; width: 30%; height: 68%; }
  .archive-highlight-card-3 { top: 17%; left: 64%; width: 27%; height: 68%; }
  .archive-highlight-card-4 { top: 10%; left: 78%; width: 20%; height: 58%; }
  .archive-highlight-card-5,
  .archive-highlight-card-6,
  .archive-highlight-feature { display: none; }
  .archive-highlight-card > span:last-child { right: 5px; bottom: 5px; left: 5px; padding: 5px 7px; }
  .archive-highlight-card > span b { font-size: 9px; }`, "mobile masthead styles");
  return source;
});

await patch("src/main.tsx", (source) => replaceOnce(source, `import "./share-fixes.css";\n`, "", "remove obsolete share fixes import"));

await patch("src/shareStudio.tsx", (source) => {
  source = replaceOnce(source, `const layoutOptions: Array<{ value: ShareLayout; label: string; description: string; icon: ReactNode }> = [
  { value: "collage", label: "拼贴", description: "大小错落", icon: <LayoutTemplate /> },
  { value: "grid", label: "网格", description: "整齐排列", icon: <Grid3X3 /> },
  { value: "timeline", label: "时间轴", description: "按日期浏览", icon: <Rows3 /> },
  { value: "cover", label: "主海报", description: "突出一场", icon: <ImageIcon /> },
];`, `const layoutOptions: Array<{ value: ShareLayout; label: string; description: string; icon: ReactNode }> = [
  { value: "collage", label: "层叠海报", description: "突出主海报", icon: <LayoutTemplate /> },
  { value: "grid", label: "整齐网格", description: "信息更完整", icon: <Grid3X3 /> },
  { value: "timeline", label: "时间线", description: "按日期浏览", icon: <Rows3 /> },
  { value: "cover", label: "主海报", description: "集中展示一场", icon: <ImageIcon /> },
];`, "share layout labels");
  source = replaceOnce(source, `const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "midnight", label: "深夜" },
  { value: "paper", label: "纸张" },
  { value: "mint", label: "薄荷" },
  { value: "sunset", label: "晚霞" },
];`, `const paletteOptions: Array<{ value: SharePalette; label: string }> = [
  { value: "midnight", label: "深色" },
  { value: "paper", label: "米白" },
  { value: "mint", label: "薄荷" },
  { value: "sunset", label: "暖色" },
];`, "share palette labels");
  source = replaceOnce(source, `  const [layout, setLayout] = useState<ShareLayout>("collage");
  const [palette, setPalette] = useState<SharePalette>("midnight");
  const [showDetails, setShowDetails] = useState(true);
  const [showBrand, setShowBrand] = useState(true);`, `  const [layout, setLayout] = useState<ShareLayout>("collage");
  const [palette, setPalette] = useState<SharePalette>("mint");
  const [headline, setHeadline] = useState("我的现场档案");
  const [itemLimit, setItemLimit] = useState<4 | 6 | 8>(6);
  const [showDetails, setShowDetails] = useState(true);
  const [showBrand, setShowBrand] = useState(true);
  const [showStats, setShowStats] = useState(true);`, "share state");
  source = replaceOnce(source, `  const maxItems = layout === "timeline" ? 8 : format === "portrait" ? 8 : 6;`, `  const maxItems = Math.min(itemLimit, layout === "timeline" ? 8 : format === "portrait" ? 8 : 6);`, "share max items");
  source = replaceOnce(source, `      await exportSharePng({ records, format, layout, palette, showDetails, showBrand });`, `      await exportSharePng({ records, format, layout, palette, headline: headline.trim() || "我的现场档案", itemLimit, showDetails, showBrand, showStats });`, "share export options");
  source = replaceOnce(source, `<span>分享制作</span>
            <h2>生成演出分享图</h2>
            <p>设置比例、排列和背景，右侧会即时预览。</p>`, `<span>分享制作</span>
            <h2>制作你的现场分享图</h2>
            <p>选择比例、海报编排和背景，右侧会即时呈现最终效果。</p>`, "share panel heading");
  source = replaceOnce(source, `        </header>

        <section className="share-control-group">`, `        </header>

        <div className="share-studio-summary"><strong>{selected.length}</strong><span>张海报已就绪</span><small>{period} · {cities} 个城市</small></div>

        <section className="share-control-group">
          <strong>分享标题</strong>
          <input className="share-headline-input" value={headline} maxLength={24} onChange={(event) => setHeadline(event.target.value)} placeholder="输入分享图标题" />
        </section>

        <section className="share-control-group">`, "share title control");
  source = replaceOnce(source, `        <section className="share-control-group">
          <strong><Palette />背景</strong>`, `        <section className="share-control-group">
          <strong>海报数量</strong>
          <div className="share-count-control">
            {([4, 6, 8] as const).map((count) => <button className={itemLimit === count ? "is-active" : ""} key={count} type="button" onClick={() => setItemLimit(count)}>{count} 张</button>)}
          </div>
        </section>

        <section className="share-control-group">
          <strong><Palette />背景</strong>`, "share count control");
  source = replaceOnce(source, `          <label>
            <input type="checkbox" checked={showBrand} onChange={(event) => setShowBrand(event.target.checked)} />
            <span><b>显示项目标识</b><small>保留“现场记”和 GitHub 项目标识。</small></span>
          </label>`, `          <label>
            <input type="checkbox" checked={showBrand} onChange={(event) => setShowBrand(event.target.checked)} />
            <span><b>显示项目标识</b><small>保留“现场记”和 GitHub 项目标识。</small></span>
          </label>
          <label>
            <input type="checkbox" checked={showStats} onChange={(event) => setShowStats(event.target.checked)} />
            <span><b>显示档案统计</b><small>展示城市数和已看场次。</small></span>
          </label>`, "share stats toggle");
  source = replaceOnce(source, `<article className={\`share-preview share-preview-${format} share-layout-${layout}\`}>
          <header>
            <div><span>MY LIVE ARCHIVE</span><h1>我的演出记录</h1><p>{period} · {records.length} 场演出</p></div>
            <strong>演</strong>
          </header>`, `<article className={\`share-preview share-preview-${format} share-layout-${layout}\`}>
          <span className="share-preview-aura" aria-hidden="true" />
          <header>
            <div><span>LIVE MEMORY · CONCERT ARCHIVE</span><h1>{headline.trim() || "我的现场档案"}</h1><p>{period} · {records.length} 场演出</p></div>
            <strong>演</strong>
          </header>`, "share preview header");
  source = replaceOnce(source, `            <strong>{cities} 城市 · {watched} 已看</strong>`, `            {showStats ? <strong>{cities} 城市 · {watched} 已看</strong> : <strong />}`, "share stats display");
  source = replaceOnce(source, `  showDetails: boolean;
  showBrand: boolean;`, `  headline: string;
  itemLimit: 4 | 6 | 8;
  showDetails: boolean;
  showBrand: boolean;
  showStats: boolean;`, "export option fields");
  source = replaceOnce(source, `  context.fillText("MY LIVE ARCHIVE", padding, padding * 0.82);`, `  context.fillText("LIVE MEMORY · CONCERT ARCHIVE", padding, padding * 0.82);`, "canvas eyebrow");
  source = replaceOnce(source, `  context.fillText("我的演出记录", padding, padding + headerHeight * 0.42);`, `  context.fillText(options.headline, padding, padding + headerHeight * 0.42);`, "canvas headline");
  source = replaceOnce(source, `  const maxItems = options.layout === "timeline" ? 8 : options.format === "portrait" ? 8 : 6;`, `  const maxItems = Math.min(options.itemLimit, options.layout === "timeline" ? 8 : options.format === "portrait" ? 8 : 6);`, "canvas max items");
  source = replaceOnce(source, `  const slots = makeSlots(options.layout, options.format, selected.length, area);
  for (let index = 0; index < slots.length; index += 1) {
    const record = selected[index];
    if (!record) break;
    await drawRecord(context, record, slots[index], palette, options.showDetails, options.layout === "timeline");
  }`, `  const slots = makeSlots(options.layout, options.format, selected.length, area);
  const orderedSlots = slots.map((slot, index) => ({ slot, index })).sort((a, b) => (a.slot.z || 0) - (b.slot.z || 0));
  for (const { slot, index } of orderedSlots) {
    const record = selected[index];
    if (!record) continue;
    await drawRecord(context, record, slot, palette, options.showDetails, options.layout === "timeline");
  }`, "canvas draw order");
  source = replaceOnce(source, `  context.fillStyle = palette.muted;
  context.font = \`700 ${Math.max(13, Math.round(width * 0.012))}px system-ui, sans-serif\`;
  context.textAlign = "right";
  context.fillText(\`${cities} 城市 · ${watched} 已看\`, width - padding, footerY);
  context.textAlign = "left";`, `  if (options.showStats) {
    context.fillStyle = palette.muted;
    context.font = \`700 ${Math.max(13, Math.round(width * 0.012))}px system-ui, sans-serif\`;
    context.textAlign = "right";
    context.fillText(\`${cities} 城市 · ${watched} 已看\`, width - padding, footerY);
    context.textAlign = "left";
  }`, "canvas stats toggle");
  source = replaceOnce(source, `  anchor.download = \`现场记-${options.format}-${new Date().toISOString().slice(0, 10)}.png\`;`, `  anchor.download = \`现场档案-${options.format}-${new Date().toISOString().slice(0, 10)}.png\`;`, "share download filename");
  source = replaceRegex(source, /function drawBackground\([\s\S]*?\n}\n\ninterface Slot/, `function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, palette: PaletteDefinition) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(0.52, palette.surface);
  gradient.addColorStop(1, palette.background[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.76, height * 0.2, 0, width * 0.76, height * 0.2, width * 0.46);
  glow.addColorStop(0, \`${palette.accent}42\`);
  glow.addColorStop(1, \`${palette.accent}00\`);
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

interface Slot`, "canvas background");
  source = replaceOnce(source, `interface Slot { x: number; y: number; width: number; height: number; }`, `interface Slot { x: number; y: number; width: number; height: number; rotation?: number; z?: number; }`, "slot metadata");
  source = replaceRegex(source, /  const normalized = format === "portrait"[\s\S]*?  return normalized\.slice\(0, count\)\.map\(\(\[x, y, width, height\]\) => \(\{[\s\S]*?  \}\)\);/, `  const normalized: Array<[number, number, number, number, number, number]> = format === "portrait"
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
  }));`, "collage slots");
  source = replaceRegex(source, /async function drawRecord\([\s\S]*?\n}\n\nfunction drawDetails/, `async function drawRecord(
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
    context.font = \`800 ${Math.max(12, slot.height * 0.15)}px system-ui, sans-serif\`;
    context.fillText(\`${record.date} · ${record.city || "城市待补"}\`, textX, y + slot.height * 0.38);
    context.fillStyle = palette.text;
    context.font = \`900 ${Math.max(15, slot.height * 0.23)}px system-ui, sans-serif\`;
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

function drawDetails`, "canvas rotated cards");
  return source;
});

const shareCss = `.share-studio-stage {
  position: fixed;
  inset: 0;
  z-index: 180;
  display: grid;
  grid-template-columns: 370px minmax(0, 1fr);
  min-height: 100vh;
  color: #16201d;
  background:
    radial-gradient(circle at 78% 16%, rgba(223, 255, 79, 0.24), transparent 24%),
    radial-gradient(circle at 22% 84%, rgba(109, 211, 190, 0.24), transparent 30%),
    linear-gradient(135deg, #dcebe5, #9ebbb2);
}

.share-studio-panel {
  position: relative;
  z-index: 4;
  display: flex;
  height: 100vh;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  overflow-y: auto;
  border-right: 1px solid rgba(20, 38, 34, 0.12);
  background: rgba(249, 249, 244, 0.9);
  box-shadow: 24px 0 70px rgba(22, 39, 35, 0.18);
  backdrop-filter: blur(28px);
}

.share-studio-panel > header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  gap: 12px;
  align-items: start;
}

.share-studio-panel > header span { color: #0b8876; font-size: 10px; font-weight: 950; letter-spacing: 0.14em; }
.share-studio-panel > header h2 { margin: 6px 0 5px; font-size: 25px; line-height: 1.08; letter-spacing: -0.045em; }
.share-studio-panel > header p { margin: 0; color: #6b7773; font-size: 11px; font-weight: 760; line-height: 1.55; }
.share-studio-panel > header button { display: grid; width: 40px; height: 40px; place-items: center; border: 1px solid rgba(20, 38, 34, 0.12); border-radius: 12px; color: inherit; background: rgba(255, 255, 255, 0.86); cursor: pointer; }
.share-studio-panel svg { width: 17px; height: 17px; }

.share-studio-summary {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 9px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid rgba(20, 38, 34, 0.1);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(223, 255, 79, 0.34), rgba(126, 218, 196, 0.15));
}
.share-studio-summary strong { grid-row: 1 / span 2; font-size: 27px; letter-spacing: -0.06em; }
.share-studio-summary span { font-size: 11px; font-weight: 900; }
.share-studio-summary small { color: #65726e; font-size: 9px; font-weight: 780; }

.share-control-group { display: grid; gap: 8px; }
.share-control-group > strong { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.share-headline-input { min-height: 42px; padding: 0 12px; border: 1px solid rgba(20, 38, 34, 0.12); border-radius: 11px; outline: 0; color: inherit; background: rgba(255, 255, 255, 0.86); font: inherit; font-size: 12px; font-weight: 850; }
.share-headline-input:focus { border-color: #0b8876; box-shadow: 0 0 0 3px rgba(11, 136, 118, 0.1); }

.share-format-control,
.share-count-control { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; border: 1px solid rgba(20, 38, 34, 0.1); border-radius: 11px; background: rgba(226, 229, 220, 0.78); }
.share-format-control button,
.share-count-control button,
.share-layout-control button,
.share-palette-control button,
.share-export-button { color: inherit; font: inherit; }
.share-format-control button,
.share-count-control button { min-height: 36px; padding: 0 4px; border: 0; border-radius: 8px; background: transparent; font-size: 10px; font-weight: 900; cursor: pointer; }
.share-format-control button.is-active,
.share-count-control button.is-active { color: #111318; background: #dfff4f; box-shadow: 0 4px 12px rgba(37, 54, 28, 0.14); }

.share-layout-control { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.share-layout-control button { display: grid; grid-template-columns: 28px minmax(0, 1fr); min-height: 60px; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid rgba(20, 38, 34, 0.11); border-radius: 12px; text-align: left; background: rgba(255, 255, 255, 0.82); cursor: pointer; }
.share-layout-control button > svg { width: 21px; height: 21px; color: #687572; }
.share-layout-control button span { display: grid; gap: 2px; }
.share-layout-control button b { font-size: 11px; }
.share-layout-control button small { color: #7a8581; font-size: 9px; }
.share-layout-control button.is-active { border-color: #0b8876; color: #0b6659; background: #e5f5ee; box-shadow: inset 0 0 0 1px #0b8876, 0 8px 20px rgba(11, 136, 118, 0.08); }
.share-layout-control button.is-active > svg { color: #0b8876; }

.share-palette-control { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.share-palette-control button { display: grid; min-height: 58px; place-items: center; gap: 4px; padding: 6px; border: 1px solid rgba(20, 38, 34, 0.1); border-radius: 11px; background: rgba(255, 255, 255, 0.82); font-size: 9px; font-weight: 850; cursor: pointer; }
.share-palette-control button i { width: 34px; height: 24px; border-radius: 8px; background: linear-gradient(135deg, #081014, #1b2a30); }
.share-palette-control button[data-palette="paper"] i { background: linear-gradient(135deg, #f4efe4, #ddd5c5); }
.share-palette-control button[data-palette="mint"] i { background: linear-gradient(135deg, #eaf9f3, #a8dac8); }
.share-palette-control button[data-palette="sunset"] i { background: linear-gradient(135deg, #54243d, #e28a69); }
.share-palette-control button.is-active { border-color: #0b8876; box-shadow: inset 0 0 0 1px #0b8876; }

.share-switches { display: grid; grid-template-columns: 1fr; gap: 7px; }
.share-switches label { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 9px; align-items: start; padding: 10px 11px; border: 1px solid rgba(20, 38, 34, 0.1); border-radius: 11px; background: rgba(255, 255, 255, 0.78); cursor: pointer; }
.share-switches input { margin-top: 3px; accent-color: #0b8876; }
.share-switches span { display: grid; gap: 2px; }
.share-switches b { font-size: 10px; }
.share-switches small { color: #737e7a; font-size: 9px; line-height: 1.4; }

.share-export-error { margin: 0; padding: 9px 10px; border: 1px solid rgba(180, 65, 54, 0.2); border-radius: 10px; color: #963f37; background: #fff0ed; font-size: 10px; font-weight: 750; line-height: 1.45; }
.share-export-button { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; gap: 8px; margin-top: auto; border: 0; border-radius: 13px; color: #111318; background: linear-gradient(135deg, #dfff4f, #a8ec61); box-shadow: 0 12px 28px rgba(91, 122, 15, 0.2); font-size: 13px; font-weight: 950; cursor: pointer; }
.share-export-button:disabled { opacity: 0.58; cursor: wait; }
.share-export-note { margin: -8px 2px 0; color: #727d79; font-size: 9px; line-height: 1.5; }

.share-preview-area { display: grid; min-width: 0; place-items: center; overflow: auto; padding: 38px; }
.share-preview {
  --share-bg-a: #081014;
  --share-bg-b: #1b2a30;
  --share-surface: #10191e;
  --share-text: #f7f8f3;
  --share-muted: #9aa9ad;
  --share-accent: #dfff4f;
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr auto;
  flex: none;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid color-mix(in srgb, var(--share-text) 16%, transparent);
  border-radius: 28px;
  color: var(--share-text);
  background:
    radial-gradient(circle at 78% 14%, color-mix(in srgb, var(--share-accent) 24%, transparent), transparent 26%),
    radial-gradient(circle at 28% 88%, color-mix(in srgb, var(--share-accent) 11%, transparent), transparent 34%),
    linear-gradient(145deg, var(--share-bg-a), var(--share-surface) 48%, var(--share-bg-b));
  box-shadow: 0 34px 90px rgba(23, 42, 38, 0.34);
}
.share-preview::after { content: ""; position: absolute; inset: 0; z-index: -1; opacity: 0.16; background-image: linear-gradient(112deg, transparent 0 47%, color-mix(in srgb, var(--share-accent) 18%, transparent) 48%, transparent 49% 100%); background-size: 190px 100%; }
.share-preview-aura { position: absolute; right: -8%; bottom: -28%; z-index: -1; width: 58%; aspect-ratio: 1; border: 1px solid color-mix(in srgb, var(--share-accent) 40%, transparent); border-radius: 50%; box-shadow: 0 0 0 36px color-mix(in srgb, var(--share-accent) 8%, transparent), 0 0 0 76px color-mix(in srgb, var(--share-accent) 5%, transparent); }

.share-theme-paper .share-preview { --share-bg-a: #f4efe4; --share-bg-b: #ddd5c5; --share-surface: #fffaf0; --share-text: #17191d; --share-muted: #6d706f; --share-accent: #0b8e7d; }
.share-theme-mint .share-preview { --share-bg-a: #eaf9f3; --share-bg-b: #a8dac8; --share-surface: #f7fcf9; --share-text: #10201b; --share-muted: #4e6f64; --share-accent: #0c8a73; }
.share-theme-sunset .share-preview { --share-bg-a: #54243d; --share-bg-b: #e28a69; --share-surface: #6a3149; --share-text: #fff7ef; --share-muted: #eccac1; --share-accent: #ffd45f; }

.share-preview-landscape { width: min(1220px, calc(100vw - 450px)); aspect-ratio: 16 / 9; }
.share-preview-portrait { width: min(760px, calc(100vw - 450px)); aspect-ratio: 3 / 4; }
.share-preview-square { width: min(900px, calc(100vw - 450px)); aspect-ratio: 1; }

.share-preview > header { position: relative; z-index: 4; display: flex; justify-content: space-between; align-items: flex-start; padding: clamp(24px, 3.4vw, 48px); }
.share-preview header span { color: var(--share-accent); font-size: 10px; font-weight: 950; letter-spacing: 0.18em; }
.share-preview header h1 { max-width: 78%; margin: 8px 0 5px; font-size: clamp(32px, 4.6vw, 68px); line-height: 0.96; letter-spacing: -0.062em; }
.share-preview header p { margin: 0; color: var(--share-muted); font-weight: 850; }
.share-preview header > strong { display: grid; width: clamp(48px, 6vw, 80px); aspect-ratio: 1; place-items: center; border-radius: 18px; color: #111318; background: linear-gradient(135deg, var(--share-accent), color-mix(in srgb, var(--share-accent) 58%, #95edff)); box-shadow: 0 16px 32px color-mix(in srgb, var(--share-accent) 18%, transparent); font-size: clamp(23px, 3vw, 39px); }

.share-preview-posters { position: relative; min-height: 0; margin: 0 clamp(24px, 3.4vw, 48px); }
.share-preview-posters figure { position: relative; margin: 0; overflow: hidden; border: clamp(2px, 0.3vw, 5px) solid color-mix(in srgb, var(--share-text) 72%, transparent); border-radius: 16px; background: var(--share-surface); box-shadow: 0 22px 48px color-mix(in srgb, #10261f 28%, transparent); }
.share-preview-posters figure > img,
.share-preview-posters figure > .share-poster-fallback { width: 100%; height: 100%; object-fit: cover; }
.share-poster-fallback { display: grid; place-items: center; padding: 10px; color: white; background: linear-gradient(135deg, var(--poster-a, #172229), var(--poster-b, #47645d)); font-size: clamp(14px, 2vw, 28px); font-weight: 950; text-align: center; }
.share-preview-posters figcaption { position: absolute; right: 0; bottom: 0; left: 0; display: grid; gap: 2px; padding: 44px 12px 12px; color: white; background: linear-gradient(transparent, rgba(0, 0, 0, 0.9)); }
.share-preview-posters figcaption span { color: var(--share-accent); font-size: 9px; font-weight: 950; }
.share-preview-posters figcaption b { overflow: hidden; font-size: clamp(11px, 1.25vw, 18px); text-overflow: ellipsis; white-space: nowrap; }
.share-preview-posters figcaption em { overflow: hidden; color: rgba(255, 255, 255, 0.68); font-size: 9px; font-style: normal; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }

.share-layout-collage .share-preview-posters { display: block; perspective: 1200px; }
.share-layout-collage .share-preview-posters figure { position: absolute; width: 27%; height: 76%; transition: transform 180ms ease; }
.share-layout-collage .share-item-1 { top: 2%; left: 34%; z-index: 6; width: 32% !important; height: 94% !important; transform: rotate(-1deg) translateZ(60px); }
.share-layout-collage .share-item-2 { top: 12%; left: 11%; z-index: 3; transform: rotate(-7deg); }
.share-layout-collage .share-item-3 { top: 10%; left: 59%; z-index: 4; transform: rotate(6deg) translateZ(20px); }
.share-layout-collage .share-item-4 { top: 19%; left: 76%; z-index: 2; width: 22% !important; height: 65% !important; transform: rotate(10deg); }
.share-layout-collage .share-item-5 { top: 28%; left: 1%; z-index: 1; width: 22% !important; height: 57% !important; transform: rotate(-10deg); }
.share-layout-collage .share-item-6 { top: 33%; left: 70%; z-index: 1; width: 20% !important; height: 54% !important; transform: rotate(3deg); }

.share-layout-grid .share-preview-posters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: clamp(8px, 1vw, 14px); }
.share-preview-portrait.share-layout-grid .share-preview-posters,
.share-preview-square.share-layout-grid .share-preview-posters { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.share-layout-timeline .share-preview-posters { display: flex; flex-direction: column; gap: clamp(7px, 0.8vw, 12px); }
.share-layout-timeline .share-preview-posters figure { display: grid; grid-template-columns: min(22%, 120px) minmax(0, 1fr); min-height: 56px; flex: 1; }
.share-layout-timeline .share-preview-posters figure > img,
.share-layout-timeline .share-preview-posters figure > .share-poster-fallback { grid-column: 1; }
.share-layout-timeline .share-preview-posters figcaption { position: static; grid-column: 2; align-content: center; padding: 9px 14px; color: var(--share-text); background: transparent; }
.share-layout-timeline .share-preview-posters figcaption b { color: var(--share-text); }
.share-layout-timeline .share-preview-posters figcaption em { color: var(--share-muted); }

.share-layout-cover .share-preview-posters { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(150px, 0.55fr); grid-template-rows: repeat(5, minmax(0, 1fr)); gap: clamp(8px, 1vw, 14px); }
.share-layout-cover .share-preview-posters figure { grid-column: 2; }
.share-layout-cover .share-item-1 { grid-column: 1 !important; grid-row: 1 / -1 !important; }

.share-preview-portrait.share-layout-collage .share-preview-posters figure { width: 46%; height: 32%; }
.share-preview-portrait.share-layout-collage .share-item-1 { top: 0; left: 13%; width: 74% !important; height: 48% !important; }
.share-preview-portrait.share-layout-collage .share-item-2 { top: 44%; left: 2%; transform: rotate(-5deg); }
.share-preview-portrait.share-layout-collage .share-item-3 { top: 43%; left: 52%; transform: rotate(5deg); }
.share-preview-portrait.share-layout-collage .share-item-4 { top: 73%; left: 8%; width: 39% !important; height: 24% !important; }
.share-preview-portrait.share-layout-collage .share-item-5 { top: 73%; left: 53%; width: 39% !important; height: 24% !important; }
.share-preview-portrait.share-layout-collage .share-item-6 { top: 67%; left: 33%; width: 34% !important; height: 27% !important; }
.share-preview-portrait.share-layout-cover .share-preview-posters { grid-template-columns: 1fr 1fr; grid-template-rows: 1.5fr repeat(3, 1fr); }
.share-preview-portrait.share-layout-cover .share-item-1 { grid-column: 1 / -1 !important; grid-row: 1 !important; }

.share-preview > footer { position: relative; z-index: 4; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: clamp(17px, 2.4vw, 32px) clamp(24px, 3.4vw, 48px); color: var(--share-muted); font-size: 10px; font-weight: 900; }
.share-preview-brand,
.share-preview-github { display: inline-flex; align-items: center; gap: 6px; }
.share-preview-brand { color: var(--share-text); }
.share-preview-brand i { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 8px; color: #111318; background: var(--share-accent); font-style: normal; }
.share-preview-github svg { width: 14px; height: 14px; }
.share-preview > footer > strong { color: var(--share-text); text-align: right; }

@media (max-width: 1050px) {
  .share-studio-stage { grid-template-columns: 330px minmax(0, 1fr); }
  .share-preview-landscape,
  .share-preview-portrait,
  .share-preview-square { width: min(94%, 900px); }
}

@media (max-width: 820px) {
  .share-studio-stage { display: block; overflow-y: auto; }
  .share-studio-panel { position: sticky; top: 0; z-index: 8; width: 100%; height: auto; max-height: 50vh; padding: 14px; border-right: 0; border-bottom: 1px solid rgba(20, 38, 34, 0.12); box-shadow: 0 15px 36px rgba(22, 39, 35, 0.2); }
  .share-studio-panel > header h2 { font-size: 20px; }
  .share-studio-summary { display: none; }
  .share-layout-control button { min-height: 50px; }
  .share-preview-area { min-height: 50vh; padding: 16px 10px 30px; }
  .share-preview-landscape,
  .share-preview-portrait,
  .share-preview-square { width: min(94vw, 720px); }
}

@media (max-width: 540px) {
  .share-studio-panel { gap: 12px; max-height: 54vh; }
  .share-layout-control { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .share-layout-control button { grid-template-columns: 1fr; justify-items: center; padding: 7px 4px; text-align: center; }
  .share-layout-control button small { display: none; }
  .share-palette-control button { min-height: 48px; }
  .share-switches { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .share-switches label { grid-template-columns: 1fr; justify-items: center; padding: 8px 5px; text-align: center; }
  .share-switches small { display: none; }
  .share-preview { border-radius: 18px; }
  .share-preview > header { padding: 18px; }
  .share-preview header h1 { max-width: 82%; font-size: 30px; }
  .share-preview-posters { margin: 0 18px; }
  .share-preview > footer { grid-template-columns: auto 1fr; padding: 14px 18px; }
  .share-preview-github { display: none; }
  .share-preview > footer > strong { text-align: right; }
}`;

await writeFile("src/shareStudio.css", shareCss);

await patch("scripts/run-tests.mjs", (source) => {
  source = replaceOnce(source, `  const experienceCss = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");`, `  const experienceCss = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");
  const shareStudio = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");
  const shareStudioCss = await readFile(new URL("../src/shareStudio.css", import.meta.url), "utf8");`, "test share files");
  source = replaceOnce(source, `  assert.match(archive, /生成分享图/);`, `  assert.match(archive, /制作分享图/);
  assert.match(archive, /archive-highlight-card/);
  assert.match(shareStudio, /share-preview-aura/);
  assert.match(shareStudio, /itemLimit/);
  assert.match(shareStudioCss, /share-layout-collage/);`, "premium visual assertions");
  return source;
});

console.log("Premium homepage and share studio redesign applied.");
