import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error("Unexpected V3 migration dependency: " + name);
  });
  return { exports, source };
}
const rev = await load("../src/core/sync/revision.ts");
const migration = await load("../src/core/application/bootstrapEquivalentBaselines.ts", {
  "../sync/revision": rev.exports,
});
const runtimeSource = await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts", import.meta.url), "utf8");
const event = (id, title) => ({
  schemaVersion: 2, id, title, date: "2026-10-01", city: "Test City",
  media: [], mediaTombstones: [], artists: [], tags: [],
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
});
const envelope = (row, revision = "1") => ({ record: structuredClone(row), serverRevision: revision });
const fake = (locals, remotes) => {
  const device = {
    scope: "user-a", rows: structuredClone(locals), reads: 0, onRead: null,
    async list() {
      this.reads += 1;
      this.onRead?.(this.reads, this);
      return structuredClone(this.rows);
    },
  };
  const cloud = {
    provider: "account", accountScope: "user-a", identity: "account-url|user-a",
    includeMedia: false, rows: structuredClone(remotes), reads: 0, onRead: null,
    async list() {
      this.reads += 1;
      this.onRead?.(this.reads, this);
      return structuredClone(this.rows);
    },
  };
  const ledger = {
    provider: "account", accountScope: "user-a", identity: "account-url|user-a",
    rows: new Map(), onCommit: null,
    async snapshot() { return new Map(this.rows); },
    async commitIfUnchanged(expected, entries) {
      this.onCommit?.();
      const acknowledgedIds = [], deferredIds = [];
      for (const {id,revision} of entries) {
        if (this.rows.get(id) !== expected.get(id)) deferredIds.push(id);
        else { this.rows.set(id,revision); acknowledgedIds.push(id); }
      }
      return { acknowledgedIds, deferredIds };
    },
  };
  return {device, cloud, ledger};
};

const same = fake([event("a","Show")], [envelope(event("a","Show"))]);
let result = await migration.exports.bootstrapEquivalentBaselines(same.device, same.cloud, same.ledger);
assert.equal(result.created, 1);
assert.equal(result.divergent, 0);
assert.equal(same.ledger.rows.get("a"), await rev.exports.recordRevision(event("a","Show"), false));
assert.equal(same.cloud.reads, 2, "Cloud must be verified again before metadata is committed");
result = await migration.exports.bootstrapEquivalentBaselines(same.device, same.cloud, same.ledger);
assert.equal(result.created, 0);
assert.equal(result.alreadyBased, 1);

const mismatch = fake([event("a","Old")], [envelope(event("a","New"))]);
result = await migration.exports.bootstrapEquivalentBaselines(mismatch.device, mismatch.cloud, mismatch.ledger);
assert.equal(result.divergent, 1);
assert.equal(result.created, 0);
assert.equal(mismatch.ledger.rows.size, 0, "Unknown history must never be made up");

const missing = fake([event("a","Keep local")], [envelope(event("b","Keep cloud"))]);
result = await migration.exports.bootstrapEquivalentBaselines(missing.device, missing.cloud, missing.ledger);
assert.equal(result.locallyAbsent, 1);
assert.equal(result.remotelyAbsent, 1);
assert.equal(result.created, 0);

const movedLocal = fake([event("a","Old")], [envelope(event("a","Old"))]);
movedLocal.device.onRead = (count, client) => {
  if (count === 2) client.rows[0].title = "Changed in a second tab";
};
result = await migration.exports.bootstrapEquivalentBaselines(movedLocal.device, movedLocal.cloud, movedLocal.ledger);
assert.equal(result.deferred, 1);
assert.equal(result.created, 0);

const movedRemote = fake([event("a","Old")], [envelope(event("a","Old"))]);
movedRemote.cloud.onRead = (count, client) => {
  if (count === 2) client.rows[0] = envelope(event("a","Different V2 revision"), "2");
};
result = await migration.exports.bootstrapEquivalentBaselines(movedRemote.device, movedRemote.cloud, movedRemote.ledger);
assert.equal(result.deferred, 1);
assert.equal(result.created, 0);

const competingTabs = fake([event("a","Old")], [envelope(event("a","Old"))]);
competingTabs.ledger.onCommit = () => competingTabs.ledger.rows.set("a", "f".repeat(64));
result = await migration.exports.bootstrapEquivalentBaselines(competingTabs.device, competingTabs.cloud, competingTabs.ledger);
assert.equal(result.created, 0);
assert.equal(result.deferred, 1);
assert.equal(competingTabs.ledger.rows.get("a"), "f".repeat(64));

await assert.rejects(migration.exports.bootstrapEquivalentBaselines(
  same.device, { ...same.cloud, identity: "different" }, same.ledger,
), /identity mismatch/);
assert.match(runtimeSource, /bootstrapMatchingHistory\(\)/);
assert.match(runtimeSource, /if \(oneSided > 0 && !options\.initialTransferApproved\)/);
assert.doesNotMatch(runtimeSource, /before\.size === 0 && oneSided/);
assert.doesNotMatch(migration.source, /\.compareAndSwap\(|\.upsert\(|\.applyRemoteIfUnchanged\(/);
console.log("V3 safe baseline bootstrap tests passed: equal history, uncertain history, two-read races, tab CAS and scope isolation.");
