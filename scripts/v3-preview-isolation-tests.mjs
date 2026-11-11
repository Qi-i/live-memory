import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import ts from "typescript";

/**
 * GitHub Pages serves the demo on the same origin as the production site.
 * Reject imports of the production app/auth/storage/client modules, even
 * transitively. The public preview may ONLY display hardcoded demo content.
 */
const project = process.cwd();
const root = resolve(project, "src/v3Standalone.tsx");
const files = new Set();
const forbiddenImports = [
  /\/(?:access|AppRoot|App|appController|supabase|storage|mediaCache|media|seeds|settingsPage|overlays|archive|shareStudio|keepsakeStudio)(?:\.|\/|$)/i,
  /\/(?:infrastructure|platforms)\//,
];
const unsafeCode = /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.serviceWorker|createClient|supabase\.from|fetch\s*\()\b/;
const blockedWeb = /\b(?:new\s+WebSocket|XMLHttpRequest|sendBeacon|postMessage\s*\()\b/;

async function visit(file) {
  if (files.has(file)) return;
  files.add(file);
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, unsafeCode, "The preview import graph may not touch user data: " + file);
  assert.doesNotMatch(source, blockedWeb, "The preview import graph may not open unreviewed communications: " + file);
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.fail("The standalone preview cannot use unchecked dynamic imports: " + file);
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const spec = statement.moduleSpecifier?.text;
    if (!spec || !spec.startsWith(".")) continue;
    const localPath = resolve(dirname(file), spec);
    for (const pattern of forbiddenImports) {
      assert.doesNotMatch(localPath, pattern, "Private production feature imported into demo: " + file);
    }
    const target = ["", ".tsx", ".ts"].map((suffix) => localPath + suffix)
      .find((candidate) => files.has(candidate) || [".tsx", ".ts"].includes(extname(candidate)));
    // Imports are TS/TSX entry points or CSS. Resolve by extension and recurse.
    const ext = extname(localPath);
    if (ext === ".css") continue;
    await visit(ext ? localPath : localPath + (spec.endsWith("Page") ? ".tsx" : ".ts"));
  }
}

// Explicit graph: keep this small and review every addition.
// The helper below verifies that each import is an existing reviewed source.
const allowed = [
  "src/v3Standalone.tsx",
  "src/ui/system/V3Preview.tsx",
  "src/ui/system/WorkspaceShell.tsx",
  "src/ui/system/DemoViews.tsx",
  "src/ui/system/demoData.ts",
  "src/ui/system/demoShare.ts",
  "src/ui/useDialogBehavior.ts",
  "src/core/sync/policy.ts",
].map((file) => resolve(project, file));
for (const file of allowed) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, unsafeCode, "Preview module uses browser storage or network: " + file);
  assert.doesNotMatch(source, blockedWeb, "Preview module uses unapproved communications: " + file);
  const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
  for (const spec of imports) {
    if (!spec.startsWith(".")) continue;
    const base = resolve(dirname(file), spec);
    const approved = allowed.some((candidate) => candidate === base + ".ts" || candidate === base + ".tsx");
    assert.ok(approved, "Preview source depends on an unreviewed module: " + file + " => " + spec);
  }
}
const entry = await readFile(resolve(project, "src/v3Standalone.tsx"), "utf8");
assert.doesNotMatch(entry, /\bAccessGate\b|\bAppRoot\b|\bApp\b/);
assert.match(entry, /V3Preview/);
const vite = await readFile(resolve(project, "vite.config.ts"), "utf8");
assert.match(vite, /VITE_V3_STANDALONE/);
assert.match(vite, /v3-preview\.html/);
const previewHtml = await readFile(resolve(project, "v3-preview.html"), "utf8");
assert.match(previewHtml, /noindex,nofollow,noarchive/);
assert.doesNotMatch(previewHtml, /main\.tsx|manifest\.webmanifest/);
console.log("V3 public demo isolation passed: only reviewed UI modules, no account, auth, storage, database or external network.");
