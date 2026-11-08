import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function moduleFrom(relative, imports = {}) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", js)(exports, name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw Error("Unexpected ledger dependency " + name);
  });
  return { exports, source };
}
const revisions = await moduleFrom("../src/core/sync/revision.ts");
const policy = await moduleFrom("../src/core/sync/policy.ts");
const apply = await moduleFrom("../src/core/sync/applyRemote.ts", { "./revision": revisions.exports });
const cloudPorts = await moduleFrom("../src/core/ports/CloudRecordAdapter.ts");
const sync = await moduleFrom("../src/core/application/synchronizeRecords.ts", {
  "../ports/CloudRecordAdapter": cloudPorts.exports,
  "../sync/revision": revisions.exports,
  "../sync/policy": policy.exports,
});
const wrapper = await moduleFrom("../src/core/application/synchronizeWithLedger.ts", {
  "./synchronizeRecords": sync.exports,
});
const idbCode = await readFile(new URL("../src/infrastructure/indexedDb/revisionLedger.ts", import.meta.url), "utf8");

const first = {
  schemaVersion: 2, id: "demo", title: "Original", date: "2026-10-01",
  city: "北京", venue: "", category: "concert", status: "watched",
  recordState: "normal", artists: [], lineup: [], companions: [], tags: [],
  setlist: [], sourceChannel: "", media: [], favorite: false,
  colors: ["#000000", "#ffffff"],
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};
const update = title => ({ ...first, title, updatedAt: "2026-11-09T00:00:00Z" });
const clone = value => structuredClone(value);

class Local {
  scope = "private-account";
  constructor(record) { this.rows = record ? [clone(record)] : []; }
  async list() { return clone(this.rows); }
  async applyRemoteIfUnchanged(snapshot, incoming, options = {}) {
    const result = apply.exports.applyRemoteAgainstLive(snapshot, incoming, this.rows, options);
    this.rows = clone(result.records);
    return result;
  }
}
class Cloud {
  provider = "account";
  accountScope = "private-account";
  identity = "account-cloud";
  includeMedia = false;
  constructor(record) {
    this.records = new Map(record ? [[record.id, { record: clone(record), serverRevision: "1" }]] : []);
  }
  async list() { return clone([...this.records.values()]); }
  async compareAndSwap(record, expected) {
    const row = this.records.get(record.id);
    if ((row?.serverRevision ?? null) !== expected) throw new cloudPorts.exports.RemoteRevisionChanged();
    const next = { record: clone(record), serverRevision: String(Number(row?.serverRevision ?? 0) + 1) };
    this.records.set(record.id, next);
    return clone(next);
  }
}
class Ledger {
  accountScope = "private-account";
  provider = "account";
  identity = "account-cloud";
  rows = new Map();
  onCommit = null;
  async snapshot() { return new Map(this.rows); }
  async commitIfUnchanged(expected, entries) {
    if (this.onCommit) { await this.onCommit(); this.onCommit = null; }
    const acknowledgedIds = [], deferredIds = [];
    for (const { id, revision } of entries) {
      if (this.rows.get(id) !== expected.get(id)) {
        deferredIds.push(id);
      } else {
        this.rows.set(id, revision);
        acknowledgedIds.push(id);
      }
    }
    return { acknowledgedIds, deferredIds };
  }
}

const local = new Local(first), remote = new Cloud(first), ledger = new Ledger();
let result = await wrapper.exports.synchronizeWithLedger(local, remote, ledger);
assert.equal(result.activity.type, "connected");
assert.equal(ledger.rows.get("demo"), await revisions.exports.recordRevision(first, false));

local.rows = [update("An ordinary edit")];
result = await wrapper.exports.synchronizeWithLedger(local, remote, ledger);
assert.deepEqual(result.uploadedIds, ["demo"]);
assert.deepEqual(result.deferredIds, []);
assert.equal(remote.records.get("demo").record.title, "An ordinary edit");
assert.equal(ledger.rows.get("demo"), await revisions.exports.recordRevision(update("An ordinary edit"), false));

result = await wrapper.exports.synchronizeWithLedger(local, remote, ledger);
assert.equal(result.activity.type, "connected", "Repeated sync must be silent and stable");

// If another tab acknowledges a different remote version during our session,
// the stale acknowledgment must be deferred, never regress the current digest.
local.rows = [update("Another new edit")];
const sentinel = "f".repeat(64);
ledger.onCommit = async () => ledger.rows.set("demo", sentinel);
result = await wrapper.exports.synchronizeWithLedger(local, remote, ledger);
assert.deepEqual(result.deferredIds, ["demo"]);
assert.equal(ledger.rows.get("demo"), sentinel);

await assert.rejects(wrapper.exports.synchronizeWithLedger(local, remote, {
  ...ledger, identity: "another-provider",
}), /identity mismatch/i);

assert.match(idbCode, /DB_NAME = "live-memory-v3-revision-ledger"/);
assert.match(idbCode, /db\.transaction\(STORE, "readwrite"\)/);
assert.match(idbCode, /const request = store\.getAll\(\)/);
assert.match(idbCode, /current\.get\(id\) !== expected\.get\(id\)/);
assert.match(idbCode, /store\.put\(\{ key: this\.prefix \+ id, revision \}/);
assert.doesNotMatch(idbCode, /store\.clear\(|deleteDatabase\(/);
assert.doesNotMatch(wrapper.source, /localStorage|indexedDB|supabase\.from|fetch\s*\(/,
  "Application-level sync coordination cannot directly depend on storage implementations");
console.log("V3 ledger tests passed: atomic acknowledgement contract, cross-tab race rejection, provider identity, ordinary edits.");
