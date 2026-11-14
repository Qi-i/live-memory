import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import ts from "typescript";
async function load(path,dependencies={}){
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exported={};
  new Function("exports","require",compiled)(exported,name=>{
    if(Object.hasOwn(dependencies,name))return dependencies[name];
    throw Error("Unexpected private mirror import dependency: "+name);
  });
  return exported;
}
const revision=await load("../src/core/sync/revision.ts");
const portable=await load("../src/core/application/portableMediaBackup.ts");
const planMod=await load("../src/core/application/planPrivateMirrorImport.ts",{
  "./portableMediaBackup":portable,"../sync/revision":revision,
});
const importer=await load("../src/core/application/importPortableBackupToSecureMirror.ts",{
  "./planPrivateMirrorImport":planMod,"../sync/revision":revision,
});
const approvals=await load("../src/core/application/verifyApprovedMirrorCopy.ts");
const uid="11111111-1111-1111-1111-111111111111";
const bytes=Buffer.from("SYNTHETIC POSTER, NOT ANY USER MEDIA");
const digest=createHash("sha256").update(bytes).digest("hex");
const data="data:image/png;base64,"+bytes.toString("base64");
const make=id=>({
  schemaVersion:2,id,title:"Synthetic concert",date:"2026-09-27",
  category:"concert",status:"watched",recordState:"normal",
  city:"sample",venue:"sample",artists:[],lineup:[],companions:[],
  tags:[],setlist:[],media:[],sourceChannel:"",favorite:false,
  colors:["#123456","#abcdef"],createdAt:"2026-09-27T10:00:00Z",
  updatedAt:"2026-09-27T11:00:00Z",
});
const first=make("first");
first.media=[{
  id:"poster",recordId:"first",kind:"poster",src:data,
  source:"local",mimeType:"image/png",size:bytes.length,
  createdAt:"2026-09-27T10:00:00Z",updatedAt:"2026-09-27T11:00:00Z",
}];
const doc={
  app:"live-memory",version:3,mediaIncluded:true,
  exportedAt:"2026-11-10T11:00:00Z",
  records:[first,make("second")],
  portableMediaManifest:{version:1,totalBytes:bytes.length,assets:[{
    recordId:"first",assetId:"poster",bytes:bytes.length,
    mimeType:"image/png",sha256:digest,
  }]},
};
const original=structuredClone(doc);
const purePlan=await planMod.planPrivateMirrorImport(doc,uid,[]);
assert.equal(purePlan.records,2);
assert.equal(purePlan.assets,1);
assert.equal(purePlan.toCreate.length,2);
assert.equal(purePlan.toCreate[0].media[0].src,"");
assert.match(purePlan.toCreate[0].media[0].storagePath,
  /^11111111-1111-1111-1111-111111111111\/v3\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/);
assert.equal(purePlan.toCreate[0].media[0].storagePath.split("/").at(-1),
  digest+".png");

const reviewedFile=createHash("sha256").update(JSON.stringify(doc)).digest("hex");
const approved=approvals.mirrorApprovalFingerprint(reviewedFile,purePlan);
assert.equal(approved,approvals.mirrorApprovalFingerprint(reviewedFile,purePlan));
assert.doesNotThrow(()=>approvals.verifyMirrorApproval(approved,approved));
const changedBytes=createHash("sha256").update("DIFFERENT FILE SAME NAME").digest("hex");
assert.throws(()=>approvals.verifyMirrorApproval(
  approved,approvals.mirrorApprovalFingerprint(changedBytes,purePlan)),
  /APPROVED_FILE_OR_REMOTE_PLAN_CHANGED/);
assert.throws(()=>approvals.verifyMirrorApproval(
  approved,approvals.mirrorApprovalFingerprint(reviewedFile,{
    ...purePlan,alreadyPresent:1,toCreate:purePlan.toCreate.slice(0,1),
  })),/APPROVED_FILE_OR_REMOTE_PLAN_CHANGED/);
assert.throws(()=>approvals.mirrorApprovalFingerprint("insecure",purePlan),/APPROVAL_INVALID/);


let account=uid,stageCalls=0,writeCalls=0,readCalls=0;
const remote=new Map();
const read=async()=>{
  readCalls++;
  return [...remote.values()].map(row=>structuredClone(row));
};
const io={
  accountUserId:uid,
  assertAccount:async()=>{
    if(account!==uid)throw Error("V3_MIRROR_ACCOUNT_CHANGED");
  },
  list:read,
  stageImage:async(asset,path,sha)=>{
    stageCalls++;
    assert.equal(asset.src,data);
    assert.equal(sha,digest);
    assert.match(path,/^11111111-1111-1111-1111-111111111111\/v3\//);
  },
  create:async row=>{
    writeCalls++;
    if(remote.has(row.id))throw Error("SYNTHETIC_CAS_CONFLICT");
    const output={record:structuredClone(row),serverRevision:"1"};
    remote.set(row.id,output);
    return output;
  },
};
const completed=await importer.importPortableBackupToSecureMirror(doc,io);
assert.deepEqual(completed,{total:2,mediaVerified:1,created:2,alreadyPresent:0});
assert.equal(stageCalls,1);
assert.equal(writeCalls,2);
assert.equal(remote.get("first").record.media[0].src,"");
assert.equal(remote.get("first").record.media[0].storagePath,
  purePlan.toCreate[0].media[0].storagePath);
assert.deepEqual(doc,original,"Importer must not mutate a portable backup");
const repeated=await importer.importPortableBackupToSecureMirror(doc,io);
assert.deepEqual(repeated,{total:2,mediaVerified:1,created:0,alreadyPresent:2});
assert.equal(writeCalls,2,"Retry must never overwrite identical cloud records");
assert.equal(stageCalls,2,"Retry must verify images even for accepted cloud rows");

// A record may exist while the linked private image has been deleted.
// Never report that record as complete without independent Storage readback.
let missingCopiesChecked=0;
await assert.rejects(importer.importPortableBackupToSecureMirror(doc,{
  ...io,
  list:read,
  stageImage:async()=>{missingCopiesChecked++;throw Error("MIRROR_IMAGE_MISSING");},
  create:async()=>{throw Error("MUST_NOT_OVERWRITE_EXISTING_RECORD");},
}),/MIRROR_IMAGE_MISSING/);
assert.equal(missingCopiesChecked,1);

// A CAS-acknowledged record can disappear or diverge before the final scan.
// Never report a successful migration with missing remote business records.
let disappearing=false;
await assert.rejects(importer.importPortableBackupToSecureMirror(doc,{
  ...io,
  list:async()=>disappearing?[]:[],
  stageImage:async()=>{},
  create:async row=>{
    disappearing=true;
    return {record:structuredClone(row),serverRevision:"1"};
  },
}),/V3_MIRROR_POST_WRITE_MISMATCH/);

const bad=structuredClone(doc);
bad.records[0].media[0].src="data:image/png;base64,"+Buffer.from("FAKE").toString("base64");
await assert.rejects(importer.importPortableBackupToSecureMirror(bad,io),
  /V3_BACKUP_MEDIA_HASH_MISMATCH|V3_BACKUP_MEDIA_TYPE_MISMATCH/);
assert.equal(writeCalls,2);

const different=[{record:{...purePlan.toCreate[0],title:"Unrelated change"},
  serverRevision:"1"}];
await assert.rejects(planMod.planPrivateMirrorImport(doc,uid,different),
  /V3_MIRROR_EXISTING_RECORD_CONFLICT/);
await assert.rejects(planMod.planPrivateMirrorImport(doc,"a".repeat(64),[]),
  /V3_MIRROR_INVALID_ACCOUNT/);
await assert.rejects(planMod.planPrivateMirrorImport(doc,uid,[
  {record:purePlan.toCreate[0],serverRevision:"1"},
  {record:purePlan.toCreate[0],serverRevision:"2"},
]),/V3_MIRROR_INVALID_REMOTE_INVENTORY/);

const empty=new Map();
let corruptedStages=0,corruptWrites=0;
await assert.rejects(importer.importPortableBackupToSecureMirror(doc,{
  ...io,
  list:async()=>[...empty.values()],
  stageImage:async()=>{corruptedStages++;throw Error("MIRROR_STORAGE_BYTES_CHANGED");},
  create:async()=>{corruptWrites++;throw Error("MUST_NOT_WRITE");},
}),/MIRROR_STORAGE_BYTES_CHANGED/);
assert.equal(corruptedStages,1);
assert.equal(corruptWrites,0,"Failed image stage prevents all following CAS writes");

let changed=false,changes=0;
await assert.rejects(importer.importPortableBackupToSecureMirror(doc,{
  ...io,
  list:async()=>{
    changes++;
    return changes===1?[]:[
      {record:{...make("unrelated"),title:"Other device add"},serverRevision:"1"},
    ];
  },
  stageImage:async()=>{throw Error("NO_STAGE_ON_DRIFT")},
  create:async()=>{throw Error("NO_CAS_ON_DRIFT")},
}),/V3_MIRROR_REMOTE_CHANGED/);

let switchedDuringStage=false,switchedWrites=0;
await assert.rejects(importer.importPortableBackupToSecureMirror(doc,{
  ...io,
  list:async()=>[],
  stageImage:async()=>{switchedDuringStage=true;},
  assertAccount:async()=>{
    if(switchedDuringStage)throw Error("V3_MIRROR_ACCOUNT_CHANGED");
  },
  create:async()=>{switchedWrites++;throw Error("MUST_NOT_WRITE");},
}),/V3_MIRROR_ACCOUNT_CHANGED/);
assert.equal(switchedWrites,0,"Account switch after staging must fence CAS");

const infra=await readFile(new URL("../src/infrastructure/supabase/importSecureArchiveMirror.ts",import.meta.url),"utf8");
const ui=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
assert.match(infra,/getAccountClient\(\)/);
assert.match(infra,/account\.auth\.getUser\(\)/);
assert.match(infra,/live_memory_v3_secure_records/);
assert.match(infra,/echo-v3-media-staging/);
assert.match(infra,/upsert:false/);
assert.match(infra,/live_memory_v3_cas_secure_account/);
assert.match(infra,/download\(expectedPath\)/);
assert.doesNotMatch(infra,/echo_text_backups|echo_passkey_records|\.remove\(|\.delete\(/);
assert.match(ui,/runMirrorImport\("inspect"\)/);
assert.match(ui,/runMirrorImport\("copy"\)/);
assert.match(ui,/const serializedBackup=JSON\.stringify\(backup\)/);
assert.match(ui,/if\(cloudRuntime\)\{[\s\S]*?setMirrorFile\(new File\(\[serializedBackup\]/);
assert.match(ui,/setMirrorPreview\(null\)/);
assert.match(ui,/已从完整备份自动载入私有镜像预演/);
assert.doesNotMatch(ui,/importSecureArchiveMirror\(backup\)/,
  "A verified export must never auto-upload without separate approval");
assert.match(ui,/确认复制到账号私有镜像（不替换 V2）/);
assert.match(ui,/mirrorApprovalFingerprint\(fileSha256,review\)/);
assert.match(ui,/mirrorApprovalFingerprint\(fileSha256,currentPlan\)/);
assert.match(ui,/verifyMirrorApproval\(/);
assert.match(ui,/crypto\.subtle\.digest\(/);
assert.doesNotMatch(ui,/live_memory_v3_activate_account\(\)|live_memory_v3_activate_personal\(\)/);
console.log("V3 authenticated private mirror passed: manifest SHA, image paths, resumability, conflicts, drift, account switch and no V2 writes.");
