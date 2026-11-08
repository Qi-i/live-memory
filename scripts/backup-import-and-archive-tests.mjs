import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/backupImport.ts", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");
const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");

const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "require", compiled)(exports, (name) => {
  if (name === "./storage") return { normalizeRecord: (record) => ({ ...record }) };
  throw new Error("Unexpected dependency: " + name);
});
const { parseBackupImport, mergeBackupAdditions } = exports;
const old = { id: "old", title: "Existing original", date: "2026-07-01", media: [] };
const importedExisting = { id: "old", title: "Overwrite attempt", date: "2026-11-08", media: [] };
const fresh = { id: "new", title: "New concert", date: "2026-11-08", media: [] };
const deleted = { id: "trashed", title: "Previously removed", date: "2026-08-08", deletedAt: "2026-09-01", media: [] };

const plan = parseBackupImport({ app: "live-memory", records: [importedExisting, fresh, deleted] }, [old], "backup.json");
assert.equal(plan.imported.length, 3);
assert.equal(plan.additions.length, 2);
assert.equal(plan.duplicateCount, 1);
assert.equal(plan.deletedCount, 1);
assert.equal(plan.existingCount, 1);
const merged = mergeBackupAdditions([old], plan);
assert.equal(merged.length, 3);
assert.equal(merged.find((row) => row.id === "old").title, "Existing original", "Never overwrite existing records");
assert.equal(merged.find((row) => row.id === "trashed").deletedAt, "2026-09-01", "Preserve deletion state");
const afterRemoteUpdate = [old, fresh];
assert.equal(mergeBackupAdditions(afterRemoteUpdate, plan).length, 3, "Do not duplicate a remotely arrived record");

for (const payload of [{ foo: 1 }, { records: [] }, { records: [null] },
  { records: [{ title: "no id" }] }, { records: [old, old] },
  { records: [{ id: "bad-media", media: [{}] }] }]) {
  assert.throws(() => parseBackupImport(payload, [old], "bad.json"));
}
assert.match(settings, /JSON 备份导入预览/);
assert.match(settings, /安全导入 JSON/);
assert.match(settings, /mergeBackupAdditions\(current, importPreview\)/);
assert.doesNotMatch(settings, /rows\.map\(\(row\) => normalizeRecord/);
assert.match(archive, /label="标签" values=\{filters\.tags\}/);
assert.match(archive, /favoritesOnly/);
assert.match(archive, /aria-pressed=\{favoritesOnly\}/);
assert.match(archive, /archive-active-summary/);
assert.match(archive, /清空所有筛选条件/);
assert.match(archive, /ref=\{searchInputRef\}/);
console.log("Backup and archive tests passed: validated additive import, duplicate protection, preserved tombstones, tags and favorites.");
