import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importPortable(path, lookup = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (moduleName) => {
    if (Object.hasOwn(lookup, moduleName)) return lookup[moduleName];
    throw new Error("Core module unexpectedly depends on: " + moduleName);
  });
  return { exports, source };
}

const rev = await importPortable("../src/core/sync/revision.ts");
const policy = await importPortable("../src/core/sync/policy.ts");
const baseline = await importPortable("../src/core/sync/baselines.ts");
const apply = await importPortable("../src/core/sync/applyRemote.ts", { "./revision": rev.exports });

const fixture = {
  schemaVersion: 2, id: "concert-1", title: "原本的演出", category: "concert",
  status: "watched", recordState: "normal", date: "2026-09-27", city: "北京",
  venue: "鸟巢", artists: ["A"], lineup: [], companions: [], tags: [],
  setlist: [], sourceChannel: "official", media: [], favorite: false,
  colors: ["#111111", "#ffffff"],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-27T08:00:00.000Z",
  syncedAt: "2026-09-27T09:00:00.000Z",
};
const localEdited = { ...fixture, title: "本机更新过的演出", updatedAt: "2026-11-08T08:00:00.000Z" };
const remoteEdited = { ...fixture, title: "手机更新过的演出", updatedAt: "2026-11-08T08:05:00.000Z" };
const timeOnly = { ...fixture, updatedAt: "2026-12-01T12:00:00.000Z", syncedAt: "2026-12-01T12:01:00.000Z" };
assert.equal(rev.exports.recordContentEqual(fixture, timeOnly), true,
  "Sync timestamps must not be interpreted as user edits");

const media = {
  id: "poster", recordId: fixture.id, kind: "poster",
  src: "https://signed.example/poster?token=ONE", storagePath: "private/poster.webp",
  updatedAt: "2026-10-01T00:00:00.000Z", source: "supabase",
};
const altSigned = { ...media, src: "https://signed.example/poster?token=TWO" };
assert.equal(rev.exports.recordContentEqual(
  { ...fixture, media: [media] }, { ...fixture, media: [altSigned] },
), true, "Rotating a signed media URL is not a new revision");
assert.equal(rev.exports.recordContentEqual(fixture, localEdited), false);
assert.equal(await rev.exports.recordRevision(fixture), await rev.exports.recordRevision(timeOnly));
assert.notEqual(await rev.exports.recordRevision(fixture), await rev.exports.recordRevision(localEdited));

const base = await rev.exports.recordRevision(fixture);
const localHash = await rev.exports.recordRevision(localEdited);
const remoteHash = await rev.exports.recordRevision(remoteEdited);
const decide = (localRevision, remoteRevision, acknowledgedRevision) =>
  policy.exports.decideRecordSync({ localRevision, remoteRevision, acknowledgedRevision });

assert.equal(decide(base, base, base).action, "unchanged");
assert.equal(decide(localHash, base, base).action, "push",
  "Normal editing on one device must sync, not pop a conflict dialog");
assert.equal(decide(base, remoteHash, base).action, "pull");
assert.equal(decide(localHash, remoteHash, base).action, "conflict",
  "Only independent edits after the same acknowledged revision are conflicts");
assert.equal(decide(localHash, remoteHash, undefined).action, "unbased-divergence",
  "Legacy records lacking a common baseline require a safe migration, not timestamp guessing");
assert.equal(decide(localHash, remoteHash, undefined).needsUserReview, true);
assert.equal(decide(base, undefined, base).action, "defer-absence",
  "A known remote record disappearing needs deletion evidence, not automatic recreation");
assert.equal(decide(undefined, base, base).action, "defer-absence",
  "A known local record disappearing must not be resurrected on next sync");
assert.equal(decide(base, undefined, undefined).action, "push-new",
  "A genuinely new local record should still be uploaded");
assert.equal(decide(undefined, base, undefined).action, "pull-new",
  "A genuinely new remote record should still be downloaded");

assert.equal(policy.exports.presentSyncActivity({ type: "connected" }).surface, "silent");
assert.equal(policy.exports.presentSyncActivity({ type: "transferred", direction: "pull", changedRecords: 0 }).surface, "silent");
assert.equal(policy.exports.presentSyncActivity({ type: "transferred", direction: "pull", changedRecords: 2 }).surface, "status-center");
assert.equal(policy.exports.presentSyncActivity({ type: "conflict", count: 1 }).surface, "attention");

const shared = [fixture];
const incoming = [remoteEdited, { ...fixture, id: "new-device-record" }];
const live = [localEdited];
const result = apply.exports.applyRemoteAgainstLive(shared, incoming, live);
assert.equal(result.records.find((r) => r.id === "concert-1")?.title, localEdited.title,
  "In-flight local edits must not be replaced by an earlier network response");
assert.deepEqual(result.deferredIds, ["concert-1"]);
assert.ok(result.acceptedIds.includes("new-device-record"),
  "Genuine new cloud records may be added without replacing local edits");
const accepted = apply.exports.applyRemoteAgainstLive(shared, [remoteEdited], [fixture]);
assert.equal(accepted.records[0].title, remoteEdited.title,
  "Remote changes can be applied if device data has not changed during the request");
const removedLocally = apply.exports.applyRemoteAgainstLive(shared, [fixture], []);
assert.equal(removedLocally.records.length, 0, "Do not resurrect a record removed during network transfer");
assert.deepEqual(removedLocally.deferredIds, ["concert-1"]);
const newIdCollision = apply.exports.applyRemoteAgainstLive([], [{ ...fixture, id: "new" }],
  [{ ...localEdited, id: "new" }]);
assert.equal(newIdCollision.records[0].title, localEdited.title,
  "A concurrently created local record must not be replaced by a remote ID collision");
assert.deepEqual(newIdCollision.deferredIds, ["new"]);

const memory = new Map();
const storage = {
  getItem(key) { return memory.get(key) ?? null; },
  setItem(key, value) { memory.set(key, value); },
};
const personalKey = await baseline.exports.createBaselineKey("scope-user-A", "personal", "https://provider.example:user-A");
const accountKey = await baseline.exports.createBaselineKey("scope-user-A", "account", "https://provider.example:user-A");
assert.notEqual(personalKey, accountKey, "Account text backup and personal cloud must never share a baseline");
const anotherAccountKey = await baseline.exports.createBaselineKey("scope-user-B", "personal", "https://provider.example:user-A");
assert.notEqual(personalKey, anotherAccountKey, "Separate account scopes require different opaque baselines");
assert.doesNotMatch(personalKey, /scope-user-A|provider\.example|https:\/\//, "No account or provider identity may be readable in the metadata key");
assert.doesNotMatch(personalKey, /provider\.example|https:\/\//, "Cloud endpoint must not appear in baseline keys");
const revisions = new baseline.exports.RevisionBaselineStore(storage, personalKey);
assert.equal(revisions.read("concert-1"), undefined);
revisions.acknowledge([{ id: "concert-1", revision: base }]);
assert.equal(revisions.read("concert-1"), base);
assert.equal(new baseline.exports.RevisionBaselineStore(storage, personalKey).read("concert-1"), base);
assert.throws(() => revisions.acknowledge([{ id: "concert-1", revision: "not-a-sha" }]));
memory.set(personalKey, '{"schema":99,"entries":{}}');
assert.throws(() => revisions.read("concert-1"), /migration/i,
  "Corrupt or incompatible baseline metadata must fail closed");

for (const module of [rev, policy, apply, baseline]) {
  assert.doesNotMatch(module.source, /from ["'](?:\.\.\/){1,4}(?:supabase|storage|appController|mediaCache)/,
    "Core sync policy must not import the network adapter or UI/controller");
}
console.log("V3 core architecture tests passed: semantic revisions, baseline decisions, stale-response safety, notification policy, provider isolation.");
