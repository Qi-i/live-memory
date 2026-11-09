import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(relative, imports={}) {
  const source=await readFile(new URL(relative,import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports={};
  new Function("exports","require",compiled)(exports,name=>{
    if(Object.hasOwn(imports,name))return imports[name];
    throw Error("Unexpected migration helper dependency: "+name);
  });
  return exports;
}
const revision=await load("../src/core/sync/revision.ts");
const guard=await load("../src/core/application/completeBackupInventory.ts",{
  "../sync/revision":revision,
});
const base={
  id:"original",title:"Protected concert",date:"2026-09-27",
  media:[{
    id:"poster",recordId:"original",kind:"poster",
    src:"https://signed.example/expired?private=OLD",
    storagePath:"owner/example/portrait.webp",
  }],
  note:"Private owner-only notes",
  updatedAt:"2026-09-27T13:00:00Z",
};
const equalRemote={...structuredClone(base),
  updatedAt:"2026-10-01T13:00:00Z",
  media:[{...base.media[0],src:"https://signed.example/new?private=NEW"}],
};
const cloud=[{record:equalRemote,serverRevision:"7"}];
const localOnly={...base,id:"only-local",title:"Local-only record",media:[]};
const cloudOnly={...base,id:"only-cloud",title:"Cloud-only concert",media:[]};
const original=structuredClone([base,localOnly]);
const remoteOriginal=structuredClone([...cloud,{record:cloudOnly,serverRevision:"2"}]);
const complete=guard.completeBackupInventory(original,remoteOriginal);
assert.deepEqual(complete.counts,{
  local:2,remote:2,shared:1,localOnly:1,remoteOnly:1,total:3,
});
assert.deepEqual(new Set(complete.records.map(x=>x.id)),
  new Set(["original","only-local","only-cloud"]),
  "A backup must include cloud-only concerts missing from this device");
const shared=complete.records.find(x=>x.id==="original");
assert.equal(shared.note,"Private owner-only notes");
assert.equal(shared.media[0].src,equalRemote.media[0].src,
  "Prefer the refreshed Storage URL for equal media over the expired local URL");
assert.deepEqual(original,[base,localOnly],
  "Reconciliation must not mutate local user data");
assert.deepEqual(remoteOriginal,[...cloud,{record:cloudOnly,serverRevision:"2"}],
  "Reconciliation must not mutate cloud snapshots");
const inline={...base,media:[{...base.media[0],src:"data:image/png;base64,AAAA"}]};
assert.equal(guard.completeBackupInventory([inline],cloud).records[0].media[0].src,
  inline.media[0].src,"Never trade available inline bytes for a signed URL");

assert.throws(()=>guard.completeBackupInventory([base],[
  {record:{...equalRemote,title:"Another device changed the title"},serverRevision:"7"},
]),/V3_COMPLETE_BACKUP_DIVERGENT_RECORDS/,
  "No guessed winner if both copies have changed privately");
assert.throws(()=>guard.completeBackupInventory([base],[
  {record:{...equalRemote,media:[{...base.media[0],storagePath:"other-owner/ticket.jpg"}]},serverRevision:"7"},
]),/V3_COMPLETE_BACKUP_DIVERGENT_RECORDS/,
  "Different poster bytes or ownership paths require explicit migration review");
assert.throws(()=>guard.completeBackupInventory([base,base],[]),
  /V3_COMPLETE_BACKUP_INVALID_INVENTORY/);
assert.throws(()=>guard.completeBackupInventory([],[cloud[0],cloud[0]]),
  /V3_COMPLETE_BACKUP_INVALID_INVENTORY/);
assert.throws(()=>guard.completeBackupInventory([base],[{record:base,serverRevision:""}]),
  /V3_COMPLETE_BACKUP_INVALID_REMOTE_REVISION/);
assert.throws(()=>guard.completeBackupInventory([],[
  {record:cloudOnly,serverRevision:""},
]),/V3_COMPLETE_BACKUP_INVALID_REMOTE_REVISION/);

guard.verifyBackupCloudUnchanged(remoteOriginal,structuredClone(remoteOriginal));
guard.verifyBackupCloudUnchanged(cloud,[
  {record:{...equalRemote,media:[{...base.media[0],src:"https://signed.example/rotated"}]},
   serverRevision:"7"},
]);
for(const corrupt of [
  [...remoteOriginal,{record:{...cloudOnly,id:"added"},serverRevision:"1"}],
  [{record:cloudOnly,serverRevision:"2"}],
  [{record:equalRemote,serverRevision:"8"},
   {record:cloudOnly,serverRevision:"2"}],
  [{record:{...equalRemote,note:"Another device edited notes"},serverRevision:"7"},
   {record:cloudOnly,serverRevision:"2"}],
])assert.throws(()=>guard.verifyBackupCloudUnchanged(remoteOriginal,corrupt),
  /V3_COMPLETE_BACKUP_CLOUD_CHANGED/);

const panel=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
const runtime=await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts",import.meta.url),"utf8");
assert.match(panel,/completeBackupInventory\(original, remoteBefore\)/);
assert.match(panel,/verifyBackupCloudUnchanged\(remoteBefore, remoteAfter\)/);
assert.match(panel,/readPersonalCloudForPortableBackup\(\)/);
assert.match(panel,/V3_COMPLETE_BACKUP_DIVERGENT_RECORDS/);
assert.match(panel,/local-only/);
assert.match(runtime,/provider !== "personal" \|\| !this\.remote\.includeMedia/,
  "Never treat account text backups as complete personal media sources");
assert.doesNotMatch(panel,/\.synchronize\(|\.compareAndSwap\(|\.upsert\(/,
  "A portable backup is strictly read-only, regardless of conflicts");
console.log("V3 complete portable backup tests passed: cloud-only rows, conflict abort, remote drift, source safety, account isolation.");
