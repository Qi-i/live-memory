import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
async function load(path){
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exported={};
  new Function("exports","require",js)(exported,name=>{throw Error("Unexpected staging runtime import: "+name)});
  return exported;
}
const audit=await load("../src/core/application/auditLegacyMediaMigration.ts");
const stage=await load("../src/core/application/stageLegacyMediaCopies.ts");
const oldOwner="a".repeat(64),uid="11111111-1111-1111-1111-111111111111";
const source=oldOwner+"/one/photo.jpg",bytes=Buffer.from("synthetic jpeg byte content");
const original=new Blob([bytes],{type:"image/jpeg"});
let scope="account A",uploadCalls=0,sourceCalls=0,stagedCalls=0;
const sourceNames=[source];
const manifest=await audit.auditLegacyMediaMigration({
  ownerKey:oldOwner,records:[{id:"concert-A",media:[{
    id:"poster-A",recordId:"concert-A",storagePath:source,
  }]}],
  assetRows:[{id:"poster-A",recordId:"concert-A",storagePath:source}],
  objectNames:sourceNames,
  download:async()=>original,
  assertScope:()=>{},
});
const storage=new Map();
const adapter={
  accountUserId:uid,sourcePaths:sourceNames,
  downloadOriginal:async(path)=>{
    assert.equal(path,source);sourceCalls++;return original;
  },
  uploadPrivate:async(path,blob,mimeType)=>{
    uploadCalls++;
    assert.equal(mimeType,"image/jpeg");
    assert.match(path,/^11111111-1111-1111-1111-111111111111\/v3\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.jpg$/);
    if(storage.has(path))return "exists";
    storage.set(path,blob);
    return "uploaded";
  },
  downloadPrivate:async(path)=>{
    stagedCalls++;return storage.get(path)||null;
  },
  assertScope:()=>{if(scope!=="account A")throw Error("V3_LEGACY_ACCOUNT_CHANGED")},
};
const result=await stage.stageLegacyMediaCopies(manifest,adapter);
assert.equal(result.objectsVerified,1);
assert.equal(result.copiesVerified,1);
assert.equal(result.bytesVerified,original.size);
assert.equal(result.manifestSha256,manifest.sha256);
assert.equal(storage.size,1);
assert.equal(uploadCalls,1);
assert.equal(sourceCalls,1);
assert.equal(stagedCalls,1);
assert.ok(!JSON.stringify(result).includes(oldOwner),
  "Staging result must never contain leaked original owner key");
const existing=await stage.stageLegacyMediaCopies(manifest,adapter);
assert.equal(existing.copiesVerified,1);
assert.equal(storage.size,1,"Retry never creates duplicate objects or upserts");
assert.equal(uploadCalls,2);
assert.equal(stagedCalls,2,"Even 409 must be re-downloaded and verified");

await assert.rejects(stage.stageLegacyMediaCopies(manifest,{
  ...adapter,downloadOriginal:async()=>new Blob(["changed"],{type:"image/jpeg"}),
}),/V3_STAGING_SOURCE_BYTES_CHANGED/);
await assert.rejects(stage.stageLegacyMediaCopies(manifest,{
  ...adapter,downloadPrivate:async()=>new Blob(["corrupt"],{type:"image/jpeg"}),
}),/V3_STAGING_PRIVATE_BYTES_MISMATCH/);
await assert.rejects(stage.stageLegacyMediaCopies(manifest,{
  ...adapter,sourcePaths:[],
}),/V3_STAGING_SOURCE_INVENTORY_CHANGED/);

const alteredProof=structuredClone(manifest);
alteredProof.totalBytes+=1;
const originalUploadCalls=uploadCalls;
await assert.rejects(stage.stageLegacyMediaCopies(alteredProof,adapter),
  /V3_STAGING_PROOF_TAMPERED/);
assert.equal(uploadCalls,originalUploadCalls,
  "A tampered manifest must be rejected before the first private object upload");
const swappedSource=structuredClone(manifest);
swappedSource.entries[0].sourcePathSha256="f".repeat(64);
await assert.rejects(stage.stageLegacyMediaCopies(swappedSource,adapter),
  /V3_STAGING_PROOF_TAMPERED/);
const wrongDestination=structuredClone(manifest);
wrongDestination.privateBucket="echo-media";
await assert.rejects(stage.stageLegacyMediaCopies(wrongDestination,adapter),
  /V3_STAGING_INVALID_PROOF/);

await assert.rejects(stage.stageLegacyMediaCopies(manifest,{
  ...adapter,accountUserId:"a".repeat(64),
}),/V3_STAGING_INVALID_PROOF/);
let switched=false;
await assert.rejects(stage.stageLegacyMediaCopies(manifest,{
  ...adapter,downloadOriginal:async()=>{
    switched=true;return original;
  },
  assertScope:()=>{if(switched)throw Error("V3_LEGACY_ACCOUNT_CHANGED")},
}),/V3_LEGACY_ACCOUNT_CHANGED/);

const events=[];
let readOnlyUploadCalls=0;
const verifiedAgain=await stage.stageLegacyMediaCopies(manifest,{
  ...adapter,
  verifyOnly:true,
  onProgress:progress=>events.push(progress),
  uploadPrivate:async()=>{readOnlyUploadCalls++;throw Error("unexpected private upload");},
});
assert.equal(readOnlyUploadCalls,0,"Read-only revalidation cannot create private objects");
assert.equal(verifiedAgain.objectsVerified,1);
assert.equal(verifiedAgain.copiesVerified,1);
assert.deepEqual(events[0],{
  originalsVerified:0,originalTotal:1,copiesVerified:0,copyTotal:1,
});
assert.deepEqual(events.at(-1),{
  originalsVerified:1,originalTotal:1,copiesVerified:1,copyTotal:1,
});
assert.ok(!JSON.stringify(events).includes(oldOwner));
await assert.rejects(stage.stageLegacyMediaCopies(manifest,{
  ...adapter,verifyOnly:true,downloadPrivate:async()=>null,
  uploadPrivate:async()=>{throw Error("must not upload on missing private copy");},
}),/V3_STAGING_PRIVATE_BYTES_MISMATCH/);

// A shared legacy source can represent more than one record-scoped private
// target: original count and private-copy count must NEVER be conflated.
const sharedRecords=[
  {id:"show-A",media:[{id:"poster-A",recordId:"show-A",storagePath:source}]},
  {id:"show-B",media:[{id:"poster-B",recordId:"show-B",storagePath:source}]},
];
const sharedManifest=await audit.auditLegacyMediaMigration({
  ownerKey:oldOwner,records:sharedRecords,assetRows:[],
  objectNames:[source],download:async()=>original,assertScope:()=>{},
});
assert.equal(sharedManifest.objects,1);
assert.equal(sharedManifest.references,2);
assert.equal(sharedManifest.entries[0].newStoragePaths.length,2);
const sharedPrivate=new Map(),sharedProgress=[];
const sharedResult=await stage.stageLegacyMediaCopies(sharedManifest,{
  ...adapter,sourcePaths:[source],
  onProgress:progress=>sharedProgress.push(progress),
  uploadPrivate:async(path,blob)=>{sharedPrivate.set(path,blob);return "uploaded";},
  downloadPrivate:async(path)=>sharedPrivate.get(path)||null,
});
assert.equal(sharedResult.objectsVerified,1);
assert.equal(sharedResult.copiesVerified,2);
assert.equal(sharedPrivate.size,2);
assert.deepEqual(sharedProgress.at(-1),{
  originalsVerified:1,originalTotal:1,copiesVerified:2,copyTotal:2,
});
const sharedUploadCount=sharedPrivate.size;
const sharedReadBack=await stage.stageLegacyMediaCopies(sharedManifest,{
  ...adapter,sourcePaths:[source],verifyOnly:true,
  uploadPrivate:async()=>{throw Error("readback must never upload");},
  downloadPrivate:async(path)=>sharedPrivate.get(path)||null,
});
assert.equal(sharedReadBack.copiesVerified,2);
assert.equal(sharedPrivate.size,sharedUploadCount);

scope="account B";
await assert.rejects(stage.stageLegacyMediaCopies(manifest,adapter),
  /V3_LEGACY_ACCOUNT_CHANGED/);

const infra=await readFile(new URL("../src/infrastructure/supabase/auditLegacyMediaSources.ts",import.meta.url),"utf8");
const panel=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
assert.match(infra,/export async function stageAuthenticatedLegacyMedia\(/);
assert.match(infra,/await auditAuthenticatedLegacyMedia\(settings,onScopeCheck,async\(ctx\)=>/);
assert.match(infra,/stageLegacyMediaCopies\(ctx\.manifest/);
assert.match(infra,/ctx\.account\.storage\.from\(staging\)\.upload\(/);
assert.match(infra,/upsert:false/);
assert.match(infra,/ctx\.account\.storage\.from\(staging\)\.download\(/);
assert.match(infra,/runtime\.readPersonalCloudForPortableBackup\(\),loadRows\(\),listObjects\(\)/);
assert.match(panel,/stageLegacyMedia\(\)/);
assert.match(panel,/开始原图私有复制/);
assert.match(panel,/v3-migration-live-status/);
assert.match(panel,/已开始原图私有复制：正在验证登录身份/);
assert.match(panel,/if\(!personalConnected\)\{/);
assert.doesNotMatch(panel,/if\(backupInFlight\.current!==null\|\|pending\|\|!personalConnected\)return/);
assert.match(panel,/只读复核已复制原图/);
assert.match(panel,/progress\.copiesVerified/);
assert.match(infra,/verifyAuthenticatedStagedLegacyMedia/);
assert.match(infra,/verifyOnly/);
assert.match(infra,/onProgress:/);

assert.doesNotMatch(infra,/\.remove\(|\.delete\(|live_memory_v3_activate_/);
console.log("V3 private media staging passed: exact byte copy, immutable retry, corruption rejection, account scope and no V2 writes.");
