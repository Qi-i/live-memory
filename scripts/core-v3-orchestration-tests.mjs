import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function moduleFrom(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", javascript)(exports, (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error("Application core unexpectedly imports " + name);
  });
  return exports;
}
const revisions = await moduleFrom("../src/core/sync/revision.ts");
const policy = await moduleFrom("../src/core/sync/policy.ts");
const app = await moduleFrom("../src/core/sync/applyRemote.ts", { "./revision": revisions });
const ports = await moduleFrom("../src/core/ports/CloudRecordAdapter.ts");
const sync = await moduleFrom("../src/core/application/synchronizeRecords.ts", {
  "../ports/CloudRecordAdapter": ports,
  "../sync/revision": revisions,
  "../sync/policy": policy,
});

const first = {
  schemaVersion: 2, id: "one", title: "原始演出", date: "2026-09-27",
  category: "concert", status: "watched", recordState: "normal",
  city: "北京", venue: "鸟巢", artists: [], lineup: [],
  companions: [], tags: [], setlist: [], sourceChannel: "",
  media: [], favorite: false, colors: ["#000000", "#ffffff"],
  createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z",
};
const edit = (record, title) => ({ ...record, title, updatedAt: "2026-11-08T00:00:00.000Z" });
const clone = (value) => structuredClone(value);

class MemoryRepo {
  scope = "user-device-1";
  constructor(rows) { this.rows = clone(rows); }
  async list() { return clone(this.rows); }
  async upsert(row) { this.rows = this.rows.filter((item) => item.id !== row.id).concat(clone(row)); }
  async applyRemoteIfUnchanged(snapshot, incoming) {
    const result = app.applyRemoteAgainstLive(snapshot, incoming, this.rows);
    this.rows = clone(result.records);
    return result;
  }
}

class MemoryCloud {
  accountScope = "user-device-1";
  identity = "personal-instance";
  provider = "personal";
  includeMedia = true;
  onList = null;
  onCompareAndSwap = null;
  constructor(rows) {
    this.byId = new Map(rows.map((row, index) => [row.id, { record: clone(row), serverRevision: String(index + 1) }]));
  }
  async list() {
    if (this.onList) await this.onList();
    return clone([...this.byId.values()]);
  }
  async compareAndSwap(row, expected) {
    if (this.onCompareAndSwap) await this.onCompareAndSwap();
    const old = this.byId.get(row.id);
    if ((old?.serverRevision ?? null) !== expected) throw new ports.RemoteRevisionChanged();
    const next = { record: clone(row), serverRevision: String(Number(old?.serverRevision ?? "0") + 1) };
    this.byId.set(row.id, next);
    return clone(next);
  }
  updateFromOtherDevice(row) {
    const old = this.byId.get(row.id);
    this.byId.set(row.id, { record: clone(row), serverRevision: String(Number(old?.serverRevision ?? "0") + 1) });
  }
}

class MemoryBaselines {
  data = new Map();
  read(id) { return this.data.get(id); }
  acknowledge(entries) { entries.forEach(({ id, revision }) => this.data.set(id, revision)); }
}

const local = new MemoryRepo([first]);
const cloud = new MemoryCloud([first]);
const bases = new MemoryBaselines();
let result = await sync.synchronizeRecords(local, cloud, bases);
assert.equal(result.reviews.length, 0);
assert.equal(result.activity.type, "connected");
assert.equal(bases.read(first.id), await revisions.recordRevision(first));

// A NORMAL edit: upload once and never create an artificial conflict.
await local.upsert(edit(first, "本机刚修改的标题"));
result = await sync.synchronizeRecords(local, cloud, bases);
assert.deepEqual(result.uploadedIds, ["one"]);
assert.equal(result.reviews.length, 0);
assert.equal(cloud.byId.get("one").record.title, "本机刚修改的标题");
result = await sync.synchronizeRecords(local, cloud, bases);
assert.equal(result.activity.type, "connected");
assert.equal(result.uploadedIds.length, 0);

// Remote-only edit is downloaded and acknowledged without overwriting unrelated items.
cloud.updateFromOtherDevice(edit(first, "手机修改的标题"));
result = await sync.synchronizeRecords(local, cloud, bases);
assert.deepEqual(result.downloadedIds, ["one"]);
assert.equal((await local.list())[0].title, "手机修改的标题");

// Genuine concurrent change after the same acknowledged revision is a review.
await local.upsert(edit(first, "本机再次修改"));
cloud.updateFromOtherDevice(edit(first, "另一台手机也修改"));
result = await sync.synchronizeRecords(local, cloud, bases);
assert.equal(result.reviews[0]?.action, "conflict");
assert.equal(result.uploadedIds.length, 0);
assert.equal((await local.list())[0].title, "本机再次修改");

// Historical records with no common baseline are never automatically overwritten.
const legacyLocal = new MemoryRepo([edit(first, "旧本机版本")]);
const legacyCloud = new MemoryCloud([edit(first, "旧云端版本")]);
const legacy = await sync.synchronizeRecords(legacyLocal, legacyCloud, new MemoryBaselines());
assert.equal(legacy.reviews[0].action, "unbased-divergence");
assert.equal(legacy.downloadedIds.length + legacy.uploadedIds.length, 0);

// Local editing while the remote query is pending must make its upload defer.
const racingLocal = new MemoryRepo([first]);
const racingCloud = new MemoryCloud([first]);
const racingBase = new MemoryBaselines();
await sync.synchronizeRecords(racingLocal, racingCloud, racingBase);
await racingLocal.upsert(edit(first, "编辑请求 A"));
racingCloud.onList = async () => {
  await racingLocal.upsert(edit(first, "网络返回前的编辑 B"));
};
const race = await sync.synchronizeRecords(racingLocal, racingCloud, racingBase);
assert.deepEqual(race.deferredIds, ["one"]);
assert.equal((await racingLocal.list())[0].title, "网络返回前的编辑 B");
assert.equal(racingCloud.byId.get("one").record.title, "原始演出");

// Server CAS mismatches are retryable; do not label them a confirmed conflict.
racingCloud.onList = null;
racingCloud.onCompareAndSwap = async () => {
  racingCloud.updateFromOtherDevice(edit(first, "云端在提交前被修改"));
  racingCloud.onCompareAndSwap = null;
};
const cas = await sync.synchronizeRecords(racingLocal, racingCloud, racingBase);
assert.deepEqual(cas.deferredIds, ["one"]);
assert.equal(cas.reviews.length, 0);
assert.equal((await racingLocal.list())[0].title, "网络返回前的编辑 B");

// Cross-account processing must fail BEFORE reading or mutating records.
const unrelated = new MemoryCloud([first]);
unrelated.accountScope = "another-account";
await assert.rejects(sync.synchronizeRecords(local, unrelated, bases), /scope/i);

console.log("V3 application sync tests passed: normal edits, remote-only updates, real concurrency, legacy migration, in-flight edits, CAS and scope.");
