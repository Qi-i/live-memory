import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(relative, imports = {}) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error("Unexpected V3 review dependency: " + name);
  });
  return { exports, source };
}
const revision = await load("../src/core/sync/revision.ts");
const policy = await load("../src/core/sync/policy.ts");
const review = await load("../src/core/application/reviewMigrationReadOnly.ts", {
  "../sync/revision": revision.exports,
  "../sync/policy": policy.exports,
});

const record = (id, title) => ({
  id, title, date: "2026-08-10", city: "Test", artists: [],
  media: [], mediaTombstones: [], tags: [], updatedAt: "2026-11-09T00:00:00Z",
});
function fixture(locals, remotes, bases = new Map()) {
  const local = { scope:"scope-a", list: async()=>structuredClone(locals) };
  const cloud = {
    provider: "personal", identity:"provider-a", accountScope:"scope-a", includeMedia:true,
    list: async()=>structuredClone(remotes).map(row=>({record:row,serverRevision:"1"})),
  };
  return [local,cloud,{read:(id)=>bases.get(id)}];
}
const unchanged = record("x","Concert");
let result = await review.exports.reviewMigrationReadOnly(...fixture([unchanged],[unchanged]));
assert.equal(result.total,0);
assert.equal(result.items.length,0);

const first=record("a","Original");
const changed={...first,title:"Updated by device"};
result=await review.exports.reviewMigrationReadOnly(...fixture([changed],[first]));
assert.equal(result.total,1);
assert.equal(result.items[0].action,"unbased-divergence");
assert.deepEqual(result.items[0].differingFields,["title"]);
assert.equal(result.items[0].title,changed.title);
assert.equal(JSON.stringify(result.items[0].differingFields).includes(changed.title),false);

const digest = await revision.exports.recordRevision(first);
result=await review.exports.reviewMigrationReadOnly(...fixture([changed],[first],new Map([["a",digest]])));
assert.equal(result.items[0].action,"push");
const remoteChanged={...first,title:"Cloud changed independently"};
result=await review.exports.reviewMigrationReadOnly(...fixture([changed],[remoteChanged],new Map([["a",digest]])));
assert.equal(result.items[0].action,"conflict");
assert.deepEqual(result.items[0].differingFields,["title"]);

result=await review.exports.reviewMigrationReadOnly(...fixture(
  [record("local","Only local")], [record("remote","Only remote")]));
assert.deepEqual(result.items.map(row=>row.action),["push-new","pull-new"]);
result=await review.exports.reviewMigrationReadOnly(...fixture(
  [record("local","Only local")], [],new Map([["local",digest]])));
assert.equal(result.items[0].action,"defer-absence");

const all=Array.from({length:125},(_,i)=>record("bulk-"+String(i).padStart(3,"0"),"List "+i));
result=await review.exports.reviewMigrationReadOnly(...fixture(all,[]));
assert.equal(result.total,125);
assert.equal(result.displayed,100);
assert.equal(result.truncated,true);

await assert.rejects(review.exports.reviewMigrationReadOnly(...fixture(
  [record("dup","a"),record("dup","b")],[])),/INVALID_INVENTORY/);
const [a,b,c]=fixture([],[]);
await assert.rejects(review.exports.reviewMigrationReadOnly(a,{...b,accountScope:"wrong"},c),/identity mismatch/);
assert.doesNotMatch(review.source,/\.compareAndSwap\(|\.upsert\(|\.acknowledge\(|\.applyRemoteIfUnchanged\(/,
  "Conflict preview must remain strictly read-only");

const ui=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
const runtime=await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts",import.meta.url),"utf8");
assert.match(runtime,/async review\(\): Promise<MigrationReview>/);
assert.match(ui,/await runtime\.review\(\)/);
assert.match(ui,/item\.differingFields\.join\("、"\)/);
assert.match(ui,/仅展示字段名称，不自动选择本机或云端版本/);
assert.doesNotMatch(ui,/console\.(log|debug|info)\(/);
console.log("V3 real-data migration review passed: no baseline, true conflicts, one-sided, 100-item safety cap, metadata-only output and RLS-scope gate.");
