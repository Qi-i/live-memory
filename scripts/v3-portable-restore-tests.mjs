import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function moduleAt(path,deps={}) {
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const out={};
  new Function("exports","require",js)(out,name=>{
    if(Object.hasOwn(deps,name))return deps[name];
    throw Error("Unexpected portable restore dependency "+name);
  });
  return {out,source};
}
const media=await moduleAt("../src/core/application/portableMediaBackup.ts");
const revisions=await moduleAt("../src/core/sync/revision.ts");
const service=await moduleAt("../src/core/application/restoreVerifiedPortableArchive.ts",{
  "./portableMediaBackup":media.out,
  "../sync/revision":revisions.out,
});
const bytes=new Blob(["ORIGINAL SYNTHETIC POSTER BYTES"],{type:"image/png"});
const raw={id:"restored-concert",title:"Restored title",date:"2026-11-10",
  media:[{id:"poster",recordId:"restored-concert",kind:"poster",src:"blob:old",source:"local",mimeType:"image/png"}]};
const backup=await media.out.createPortableBackup([raw],{
  assertScope(){},
  async load(){return bytes;},
  async encode(blob){return "data:image/png;base64,"+Buffer.from(await blob.arrayBuffer()).toString("base64");},
});
const records=new Map();
let writes=0;
const port={
  async insertMissingAtomic(rows) {
    const insertedIds=[],alreadyPresentIds=[];
    for(const row of rows){
      const older=records.get(row.id);
      if(older && revisions.out.stableSerialize(older)!==revisions.out.stableSerialize(row))
        throw Error("V3_RESTORE_EXISTING_RECORD_CONFLICT");
      if(older)alreadyPresentIds.push(row.id);
      else {records.set(row.id,structuredClone(row));insertedIds.push(row.id);writes++;}
    }
    return {insertedIds,alreadyPresentIds};
  },
  async list(){return [...records.values()].map(structuredClone);},
};
const restored=await service.out.restoreVerifiedPortableArchive(backup,port,()=>{});
assert.deepEqual(restored,{inserted:1,alreadyPresent:0,
  verifiedAssets:1,verifiedBytes:bytes.size});
assert.equal(writes,1);
assert.equal(records.get(raw.id).media[0].src,backup.records[0].media[0].src);
const again=await service.out.restoreVerifiedPortableArchive(backup,port,()=>{});
assert.equal(again.inserted,0);assert.equal(again.alreadyPresent,1);
assert.equal(writes,1,"No duplicate record was overwritten");
const tampered=structuredClone(backup);
tampered.records[0].media[0].src="data:image/png;base64,"+Buffer.from("TAMPERED").toString("base64");
await assert.rejects(service.out.restoreVerifiedPortableArchive(tampered,port,()=>{}),/HASH_MISMATCH/);
assert.equal(writes,1,"Bad media must be rejected before any write");
const conflict=structuredClone(backup);
conflict.records[0].title="Different title";
await assert.rejects(service.out.restoreVerifiedPortableArchive(conflict,port,()=>{}),/EXISTING_RECORD_CONFLICT/);
assert.equal(records.get(raw.id).title,raw.title);
await assert.rejects(service.out.restoreVerifiedPortableArchive(backup,port,()=>{throw Error("SCOPE_CHANGED")}),/SCOPE_CHANGED/);
const corruptedPort={
  ...port,
  async insertMissingAtomic(rows){return {insertedIds:[rows[0].id],alreadyPresentIds:[]};},
  async list(){return [{...backup.records[0],title:"POSTCOMMIT TAMPER"}];},
};
await assert.rejects(service.out.restoreVerifiedPortableArchive(backup,corruptedPort,()=>{}),/READBACK_CONTENT_MISMATCH/);
const repoSource=await readFile(new URL("../src/infrastructure/indexedDb/recordRepository.ts",import.meta.url),"utf8");
assert.match(repoSource,/async insertMissingAtomic\(/);
assert.match(repoSource,/db\.transaction\(RECORD_STORE, "readwrite"\)/);
assert.match(repoSource,/store\.add\(row\)/);
assert.match(repoSource,/V3_RESTORE_EXISTING_RECORD_CONFLICT/);
const workspace=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
assert.match(workspace,/restoreVerifiedPortableArchive\(/);
assert.match(workspace,/verifyPortableBackupDocument\(parsed\)/);
assert.match(workspace,/canEdit && <section className="v3-real-restore"/);
assert.match(workspace,/ShareStudio records=\{records\}/);
assert.doesNotMatch(service.source,/replaceAllRecords|\.delete\(|\.remove\(|\.upsert\(/);
console.log("V3 portable restoration: original bytes, additive transaction, duplicate preservation, tamper, conflict, scope fence and post-write readback passed.");
