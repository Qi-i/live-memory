import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
import {createHash} from "node:crypto";

const source=await readFile(new URL("../src/core/application/auditLegacyMediaMigration.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const manifest={};
new Function("exports","require",js)(manifest,name=>{
  throw Error("Unexpected migration audit runtime import: "+name);
});
const owner="a".repeat(64);
const p1=owner+"/sample/photo-one.jpg", p2=owner+"/nested/photo-two.png";
const rows=[
  {id:"asset1",recordId:"show1",storagePath:p1},
  {id:"asset2",recordId:"show2",storagePath:p2},
];
const records=[
  {id:"show1",media:[{id:"asset1",recordId:"show1",storagePath:p1}]},
  {id:"show2",media:[{id:"asset2",recordId:"show2",storagePath:p2}]},
];
const blobs=new Map([
  [p1,new Blob([Buffer.from("fake jpeg test bytes")],{type:"image/jpeg"})],
  [p2,new Blob([Buffer.from("fake png test bytes")],{type:"image/png"})],
]);
let reads=0;
const fixture={
  ownerKey:owner,records,assetRows:rows,objectNames:[p1,p2],
  download:async(path)=>{reads++;return blobs.get(path)},
  assertScope:()=>{},
};
const result=await manifest.auditLegacyMediaMigration(fixture);
assert.equal(result.format,"live-memory-v3-legacy-media-preflight");
assert.equal(result.version,1);
assert.equal(result.objects,2);
assert.equal(result.references,2);
assert.equal(result.entries.length,2);
assert.equal(reads,2,"Each unique legacy picture is downloaded exactly once");
assert.equal(result.sha256.length,64);
const redacted=JSON.stringify(result);
assert.ok(!redacted.includes(owner),"Never leak raw ownerKey into the exported manifest");
assert.ok(!redacted.includes("sample/photo-one.jpg") &&
  !redacted.includes("nested/photo-two.png"),
  "Never include original Storage paths from public signed URLs");
for(const entry of result.entries){
  assert.equal(entry.sourcePathSha256.length,64);
  assert.equal(entry.contentSha256.length,64);
  assert.equal(entry.newStoragePaths.length,1);
  assert.match(entry.newStoragePaths[0],/^[a-f0-9]{64}\/v3\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.(?:jpg|png)$/);
  assert.ok(!entry.newStoragePaths[0].includes(owner));
}
const hash=x=>createHash("sha256").update(x).digest("hex");
assert.ok(result.entries.some(x=>x.sourcePathSha256===hash(p1)));
assert.ok(result.entries.some(x=>x.sourcePathSha256===hash(p2)));
const again=await manifest.auditLegacyMediaMigration(fixture);
assert.equal(result.sha256,again.sha256,
  "Repeated unchanged media must have an identical migration digest");

await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,objectNames:[p1,p2,p2],
}),/V3_LEGACY_MEDIA_INVALID_INVENTORY/);
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,objectNames:[p1],
}),/V3_LEGACY_MEDIA_MISSING_OBJECT/);
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,objectNames:[p1,p2,owner+"/orphan.jpg"],
}),/V3_LEGACY_MEDIA_ORPHAN_OBJECT/);
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,assetRows:[...rows,{...rows[0],storagePath:p2}],
}),/V3_LEGACY_MEDIA_CONFLICTING_REFERENCES/);
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,assetRows:[{...rows[0],storagePath:"b".repeat(64)+"/theft.jpg"},rows[1]],
}),/V3_LEGACY_MEDIA_FOREIGN_PATH/);
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,download:async()=>new Blob(["<html>fake</html>"],{type:"text/html"}),
}),/V3_LEGACY_MEDIA_MIME_MISMATCH/);
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,download:async()=>new Blob([], {type:"image/jpeg"}),
}),/V3_LEGACY_MEDIA_BYTES_UNAVAILABLE/);
let scope="owner A",requests=0;
await assert.rejects(manifest.auditLegacyMediaMigration({
  ...fixture,download:async path=>{
    requests++;scope="owner B";return blobs.get(path);
  },
  assertScope:()=>{if(scope!=="owner A")throw Error("V3_LEGACY_ACCOUNT_CHANGED")},
}),/V3_LEGACY_ACCOUNT_CHANGED/);
assert.equal(requests,1,"Account switch must abort before downloading other image bytes");

const service=await readFile(new URL("../src/infrastructure/supabase/auditLegacyMediaSources.ts",import.meta.url),"utf8");
const panel=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
const supabase=await readFile(new URL("../src/supabase.ts",import.meta.url),"utf8");
assert.match(service,/account\.auth\.getUser\(\)/);
assert.match(service,/deriveAccountLinkedLegacyOwnerKey\(settings, userId\)/);
assert.match(service,/expectedOwnerKey !== ownerKey/);
assert.match(service,/V3_LEGACY_OWNER_NOT_BOUND_TO_ACCOUNT/);
assert.match(service,/readPersonalCloudForPortableBackup\(\)/);
assert.match(service,/personal\.from\("echo_passkey_media_assets"\)/);
assert.match(service,/personal\.storage\.from\(BUCKET\)\.list\(/);
assert.match(service,/personal\.storage\.from\(BUCKET\)\.download\(/);
assert.match(service,/verifyBackupCloudUnchanged\(cloudBefore,cloudAfter\)/);
assert.match(service,/fingerprintRows\(linkedBefore\)!==fingerprintRows\(linkedAfter\)/);
assert.match(service,/fingerprintPaths\(objectsBefore\)!==fingerprintPaths\(objectsAfter\)/);
assert.match(panel,/exportLegacyMediaAudit/);
assert.match(panel,/auditAuthenticatedLegacyMedia\(settings,assertScope\)/);
assert.match(supabase,/deriveAccountLinkedLegacyOwnerKey/);
assert.doesNotMatch(service.split("export async function stageAuthenticatedLegacyMedia(")[0],
  /\.upload\(|\.remove\(|\.update\(|\.upsert\(|\.copy\(/,
  "The source audit must remain strictly read-only, even when a separate staging action exists");
assert.doesNotMatch(panel,/activate_personal|activate_account/);
console.log("V3 read-only legacy media proof passed: exact Storage inventory, SHA-256, redaction, account binding, no writes.");
