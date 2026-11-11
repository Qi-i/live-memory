import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function moduleFrom(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error("Unexpected application dependency: " + name);
  });
  return { source, exports };
}
const revision = await moduleFrom("../src/core/sync/revision.ts");
const ports = await moduleFrom("../src/core/ports/RecordRepository.ts");
const application = await moduleFrom("../src/core/application/saveRecordDraft.ts", {
  "../ports/RecordRepository": ports.exports,
});
const idbSource = await readFile(new URL("../src/infrastructure/indexedDb/recordRepository.ts", import.meta.url), "utf8");

const record = {
  schemaVersion: 2, id: "record-v3", title: "鸟巢演唱会", date: "2026-09-27",
  category: "concert", status: "watched", recordState: "normal", city: "北京",
  venue: "国家体育场", artists: [], lineup: [], companions: [], tags: [],
  setlist: [], sourceChannel: "", media: [], favorite: false,
  colors: ["#123456", "#ffffff"],
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:00.000Z",
};
const updated = (title) => ({ ...record, title, updatedAt: "2026-11-08T10:00:00.000Z" });

class InMemoryEditorRepository {
  scope = "user-test";
  records = new Map();
  constructor(initial = []) { initial.forEach((r) => this.records.set(r.id, structuredClone(r))); }
  async saveIfUnchanged(draft, expected) {
    const current = this.records.get(draft.id);
    const same = expected === null
      ? current === undefined
      : Boolean(current && revision.exports.recordContentEqual(current, expected));
    if (!same) throw new ports.exports.LocalRevisionChanged(draft.id);
    this.records.set(draft.id, structuredClone(draft));
  }
}

const repository = new InMemoryEditorRepository([record]);
const first = await application.exports.saveRecordDraft(repository, updated("第一次编辑"), record);
assert.equal(first.status, "saved");
assert.equal(repository.records.get(record.id).title, "第一次编辑");

const stale = await application.exports.saveRecordDraft(repository, updated("来自旧窗口的修改"), record);
assert.equal(stale.status, "review-required",
  "An editor opened before another save must report concurrent editing, not silently overwrite");
assert.equal(repository.records.get(record.id).title, "第一次编辑",
  "A rejected stale draft must not destroy the current record");
const newest = structuredClone(repository.records.get(record.id));
const next = await application.exports.saveRecordDraft(repository, updated("第二次正常编辑"), newest);
assert.equal(next.status, "saved", "Serial edits from the latest version are normal updates");
assert.equal(repository.records.get(record.id).title, "第二次正常编辑");

const newRecord = { ...record, id: "new" };
assert.equal((await application.exports.saveRecordDraft(repository, newRecord, null)).status, "saved");
assert.equal((await application.exports.saveRecordDraft(repository, newRecord, null)).status, "review-required",
  "Duplicate IDs must not overwrite during concurrent creation");

await assert.rejects(application.exports.saveRecordDraft(repository, updated(""), newest), /name/i);
await assert.rejects(application.exports.saveRecordDraft(repository, { ...record, id: "wrong" }, newest), /baseline/i);

assert.match(idbSource, /const tx = db\.transaction\(RECORD_STORE, "readwrite"\)/);
assert.match(idbSource, /const currentRequest = store\.get\(record\.id\)/);
assert.match(idbSource, /recordContentEqual\(normalizeRecord\(existing\), expectedSnapshot\)/);
assert.match(idbSource, /new LocalRevisionChanged\(record\.id\)/);
assert.match(idbSource, /tx\.abort\(\)/);
assert.doesNotMatch(application.source, /localStorage|indexedDB|supabase\.from|window\./,
  "Editor application commands may not depend on browser/cloud implementation");
console.log("V3 editor safety contracts passed: normal serial saves, stale-tab rejection, duplicate ID guard, no silent overwrites.");
