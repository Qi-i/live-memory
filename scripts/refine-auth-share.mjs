import { readFile, writeFile } from "node:fs/promises";

async function patchFile(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

function replaceOrFail(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing replacement target: ${label}`);
  return source.replace(search, replacement);
}

await patchFile("src/supabase.ts", (source) => replaceOrFail(
  source,
  `function oauthRedirectUrl() {\n  if (typeof window === "undefined") return undefined;\n  const base = import.meta.env.BASE_URL || "/";\n  return new URL(base, window.location.origin).toString();\n}`,
  `const LIVE_MEMORY_PUBLIC_URL = "https://qi-i.github.io/live-memory/";\n\nfunction oauthRedirectUrl() {\n  if (typeof window === "undefined") return LIVE_MEMORY_PUBLIC_URL;\n  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";\n  if (isLocal) return new URL(import.meta.env.BASE_URL || "/", window.location.origin).toString();\n  return LIVE_MEMORY_PUBLIC_URL;\n}`,
  "fixed OAuth callback",
));

await patchFile("src/archive.tsx", (source) => {
  let next = source;
  next = replaceOrFail(
    next,
    `import {\n  categoryLabels,`,
    `import { ShareStudio, type ShareFormat } from "./shareStudio";\nexport type { ShareFormat } from "./shareStudio";\nimport {\n  categoryLabels,`,
    "ShareStudio import",
  );
  next = replaceOrFail(
    next,
    `export type ArchiveLayout = ArchiveView | "showcase";\nexport type ShareFormat = "landscape" | "portrait" | "square";`,
    `export type ArchiveLayout = ArchiveView | "showcase";`,
    "ShareFormat type",
  );
  next = replaceOrFail(next, `<ShareCanvas`, `<ShareStudio`, "ShareStudio render");
  next = replaceOrFail(
    next,
    `      <header className="archive-masthead">\n        <div>\n          <span>我的演出记录</span>\n          <h2>把看过和想看的演出放在一起。</h2>\n          <p>可以按海报、票根、时间、城市或票价查看，视图随时切换。</p>\n        </div>\n        <ArchiveHighlights records={records} onOpen={onOpen} />\n      </header>`,
    `      <header className="archive-masthead">\n        <div className="archive-masthead-copy">\n          <span>我的演出记录</span>\n          <h2>现场，一场一场地留下来。</h2>\n          <p>海报、票根、日期和城市都放在同一个档案里，需要时再切换查看方式。</p>\n          <div className="archive-masthead-stats" aria-label="演出记录摘要">\n            <strong>{records.length}<span>全部记录</span></strong>\n            <strong>{records.filter((record) => record.status === "watched").length}<span>已经看过</span></strong>\n            <strong>{new Set(records.map((record) => record.city).filter(Boolean)).size}<span>到访城市</span></strong>\n          </div>\n        </div>\n        <ArchiveHighlights records={records} onOpen={onOpen} />\n      </header>`,
    "compact archive masthead",
  );
  const start = next.indexOf("function ShareCanvas(");
  const end = next.indexOf("function RecordMedia(", start);
  if (start < 0 || end < 0) throw new Error("Missing legacy ShareCanvas block");
  return next.slice(0, start) + next.slice(end);
});

await patchFile("src/archive.css", (source) => {
  if (source.includes("/* Compact archive masthead v2 */")) throw new Error("Archive masthead override already present");
  return `${source}\n\n/* Compact archive masthead v2 */\n.archive-masthead {\n  grid-template-columns: minmax(0, 1.45fr) minmax(280px, .55fr);\n  min-height: 176px;\n}\n\n.archive-masthead-copy {\n  display: grid;\n  align-content: center;\n  padding: clamp(22px, 3vw, 34px);\n  background:\n    radial-gradient(circle at 88% 12%, color-mix(in srgb, var(--experience-accent-2) 24%, transparent), transparent 32%),\n    linear-gradient(135deg, color-mix(in srgb, var(--experience-accent) 12%, var(--experience-surface-solid)), var(--experience-surface-solid));\n}\n\n.archive-masthead h2 {\n  max-width: 760px;\n  margin: 7px 0 8px;\n  font-size: clamp(30px, 3.25vw, 48px);\n  line-height: 1.02;\n}\n\n.archive-masthead p {\n  max-width: 700px;\n  font-size: 13px;\n  line-height: 1.55;\n}\n\n.archive-masthead-stats {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 7px;\n  margin-top: 15px;\n}\n\n.archive-masthead-stats strong {\n  display: grid;\n  min-width: 86px;\n  padding: 7px 10px;\n  border: 1px solid color-mix(in srgb, var(--experience-text) 8%, transparent);\n  border-radius: 9px;\n  background: color-mix(in srgb, var(--experience-surface-solid) 76%, transparent);\n  font-size: 16px;\n}\n\n.archive-masthead-stats span {\n  margin-top: 3px;\n  color: var(--experience-muted);\n  font-size: 9px;\n  font-weight: 850;\n}\n\n.archive-highlights,\n.archive-highlight-empty { min-height: 176px; }\n\n.archive-highlights button {\n  top: calc(12px + var(--highlight-index) * 2px);\n  right: calc(14px + var(--highlight-index) * 38px);\n  width: 108px;\n  height: 148px;\n  border-width: 3px;\n}\n\n@media (max-width: 1020px) {\n  .archive-masthead { min-height: 160px; }\n}\n\n@media (max-width: 720px) {\n  .archive-masthead { min-height: 0; }\n  .archive-masthead-copy { padding: 16px; }\n  .archive-masthead h2 { font-size: 29px; }\n  .archive-masthead p { display: block; font-size: 11px; }\n  .archive-masthead-stats { margin-top: 11px; }\n  .archive-masthead-stats strong { min-width: 72px; padding: 6px 8px; font-size: 14px; }\n}\n`;
});

await patchFile("docs/deployment.md", (source) => source
  .replace('`vite.config.ts` 使用 `base: "./"`，避免仓库子路径下静态资源 404。', '`vite.config.ts` 使用固定项目路径 `base: "/live-memory/"`，确保静态资源和 OAuth 回跳都位于 GitHub Pages 项目站点。')
  .replace('确认构建产物使用相对路径，并清理旧 Service Worker 缓存后刷新。当前 `vite.config.ts` 已为 GitHub 项目页设置相对 base。', '确认构建产物使用 `/live-memory/` 项目路径，并清理旧 Service Worker 缓存后刷新。Supabase Auth 的 Site URL 与 Redirect URLs 也必须包含 `https://qi-i.github.io/live-memory/`。'));

console.log("OAuth callback, compact masthead and ShareStudio integration applied.");
