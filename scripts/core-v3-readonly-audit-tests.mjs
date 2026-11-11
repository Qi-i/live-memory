import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function moduleFrom(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exports={};
  new Function("exports","require",js)(exports, name=>{
    if(Object.hasOwn(imports,name))return imports[name];
    throw Error("Unexpected dependency in read-only sync audit: "+name);
  });
  return {exports,source};
}
const revisions=await moduleFrom("../src/core/sync/revision.ts");
const policy=await moduleFrom("../src/core/sync/policy.ts");
const audit=await moduleFrom("../src/core/application/auditSyncReadOnly.ts",{
  "../sync/revision":revisions.exports,
  "../sync/policy":policy.exports,
});
const record={id:"PRIVATE_RECORD_ID",title:"PRIVATE_CONCERT_TITLE",date:"2026-08-18",city:"PRIVATE_CITY",
  media:[],artists:[],tags:[],recordState:"normal",status:"watched"};
const newer={...record,title:"CHANGED_PRIVATE_TITLE",updatedAt:"2026-11-09T00:00:00Z"};
const originalHash=await revisions.exports.recordRevision(record);
const fakeLocal=rows=>({scope:"owned-scope",list:async()=>structuredClone(rows)});
const fakeCloud=(rows,provider="personal")=>({
  provider,accountScope:"owned-scope",identity:"cloud-provider",includeMedia:provider==="personal",
  list:async()=>structuredClone(rows).map(row=>({record:row,serverRevision:"1"})),
});
const baseline=(revision)=>({read:()=>revision});
const equal=await audit.exports.auditSyncReadOnly(fakeLocal([record]),fakeCloud([record]),baseline(originalHash));
assert.equal(equal.checkedRecords,1);
assert.equal(equal.actions.unchanged,1);
assert.equal(equal.unresolved,0);
assert.equal(equal.requiresMigrationReview,false);
assert.equal(JSON.stringify(equal).includes(record.title),false);
assert.equal(JSON.stringify(equal).includes(record.id),false);

const changedHere=await audit.exports.auditSyncReadOnly(fakeLocal([newer]),fakeCloud([record]),baseline(originalHash));
assert.equal(changedHere.actions.push,1);
assert.equal(changedHere.unresolved,0);
const changedThere=await audit.exports.auditSyncReadOnly(fakeLocal([record]),fakeCloud([newer]),baseline(originalHash));
assert.equal(changedThere.actions.pull,1);
const unbased=await audit.exports.auditSyncReadOnly(fakeLocal([record]),fakeCloud([newer]),baseline(undefined));
assert.equal(unbased.actions["unbased-divergence"],1);
assert.equal(unbased.requiresMigrationReview,true);
const ambiguousMissing=await audit.exports.auditSyncReadOnly(fakeLocal([]),fakeCloud([record]),baseline(originalHash));
assert.equal(ambiguousMissing.actions["defer-absence"],1);
assert.equal(ambiguousMissing.unresolved,1);

await assert.rejects(audit.exports.auditSyncReadOnly(fakeLocal([]),
  {...fakeCloud([record]),accountScope:"another-user"},baseline(originalHash)),/identity mismatch/);
await assert.rejects(audit.exports.auditSyncReadOnly(
  fakeLocal([record,record]),fakeCloud([]),baseline(originalHash)),/Duplicate record IDs/);
assert.doesNotMatch(audit.source,/\.upsert\(|\.compareAndSwap\(|\.acknowledge\(|\.applyRemoteIfUnchanged\(/,
  "Read-only preflight may never write or acknowledge baseline revisions");
console.log("V3 safe migration preflight passed: semantic counts, unbased history, deletions, account isolation and no user-data exposure.");
