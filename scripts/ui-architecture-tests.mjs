import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/ui/editorModel.ts", import.meta.url), "utf8");
const hook = await readFile(new URL("../src/ui/useDialogBehavior.ts", import.meta.url), "utf8");
const primitives = await readFile(new URL("../src/ui/PagePrimitives.tsx", import.meta.url), "utf8");
const overlay = await readFile(new URL("../src/overlays.tsx", import.meta.url), "utf8");
const theme = await readFile(new URL("../src/liquidStage.css", import.meta.url), "utf8");
const editor = await readFile(new URL("../src/ui/editorWorkflow.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", compiled)(exports);
const { validateEditorRecord, editorSignature } = exports;
const base = {
  title: "真正的现场", artists: ["Artist"], category: "concert", status: "watched", recordState: "normal",
  date: "2024-02-29", city: "Beijing", venue: "Venue", price: 250, publicPriceRange: "",
  seat: "", companions: [], tags: [], sourceUrl: "", sourceChannel: "", note: "",
  setlist: [], media: [],
};
assert.equal(validateEditorRecord(base), null);
assert.match(validateEditorRecord({ ...base, date: "2025-02-29" }), /日期/);
assert.match(validateEditorRecord({ ...base, date: "2024-13-01" }), /日期/);
assert.match(validateEditorRecord({ ...base, date: "2024-04-31" }), /日期/);
assert.match(validateEditorRecord({ ...base, date: "unparseable" }), /日期/);
assert.match(validateEditorRecord({ ...base, title: " " }), /名称/);
assert.match(validateEditorRecord({ ...base, price: -10 }), /票价/);
assert.equal(editorSignature(base), editorSignature({ ...base, media: [], title: "真正的现场" }));
assert.notEqual(editorSignature(base), editorSignature({ ...base, title: "修改过的演出" }));
assert.notEqual(editorSignature(base), editorSignature({ ...base, media: [{ id: "poster-one", kind: "poster" }] }));
assert.match(hook, /layers\[layers.length - 1\] !== layer/);
assert.match(hook, /event.key === "Escape"/);
assert.match(hook, /event.key !== "Tab"/);
assert.match(hook, /document.body.style.overflow = "hidden"/);
assert.match(hook, /previousFocus\?\.focus/);
assert.match(primitives, /export function SectionHeading/);
assert.match(primitives, /export function EmptyState/);
assert.match(overlay, /<EditorSection id="editor-about"/);
assert.match(overlay, /<EditorSection id="editor-ticket"/);
assert.match(overlay, /<EditorSection id="editor-media"/);
assert.match(overlay, /<EditorSection id="editor-memory"/);
assert.match(overlay, /放弃这次编辑？/);
assert.match(overlay, /validateEditorRecord\(draft\)/);
assert.match(overlay, /editorSignature\(draft\)/);
assert.match(theme, /data-visual-theme="aurora"/);
assert.match(theme, /backdrop-filter: blur/);
assert.match(theme, /prefers-reduced-motion/);
assert.match(editor, /scroll-padding-top/);
assert.match(main, /import "\.\/liquidStage.css";/);
assert.match(main, /import "\.\/ui\/editorWorkflow.css";/);
console.log("UI architecture regression passed: strict dates, dirty signature, four sections, dialog stack, unified material tokens.");
