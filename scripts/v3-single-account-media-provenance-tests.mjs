import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

const source=await readFile(new URL("../src/core/application/verifyLegacyAccountProvenance.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const exports={};
new Function("exports",js)(exports);
const {verifyLegacyAccountProvenance:verify}=exports;
const a=(id,deleted_at=null)=>({
  id,deleted_at,payload:{
    id,title:"同一账户巡演 "+id,date:"2026-10-18",
    artists:["甲","乙"],city:"天津",venue:"体育馆",
    note:"票根备注",updatedAt:"2026-10-20T10:00:00Z",
    deletedAt:deleted_at||undefined,
    media:[{id:"asset-"+id,src:"data:image/png;base64,foo"}],
    syncedAt:"2026-11-01T10:00:00Z",
  },
});
const p=[a("one"),a("two"),a("three","2026-11-08T12:00:00Z")];
const b=p.map(x=>({...structuredClone(x),payload:{
  ...structuredClone(x.payload),
  media:[{id:"asset",src:""}],syncedAt:"2026-11-11T12:00:00Z",
}}));
const result=await verify(p,b);
assert.equal(result.matchedRecords,3);
assert.match(result.sourceDigest,/^[a-f0-9]{64}$/);
const reversed=await verify([...p].reverse(),[...b].reverse());
assert.equal(reversed.sourceDigest,result.sourceDigest,"Provenance independent of paging order");
const withOtherMedia=b.map(x=>({...x,payload:{...x.payload,media:[]}}));
assert.equal((await verify(p,withOtherMedia)).sourceDigest,result.sourceDigest);
const altered=b.map(x=>structuredClone(x));altered[0].payload.note="冒领更改";
await assert.rejects(verify(p,altered),/V3_LEGACY_PROVENANCE_CONTENT_MISMATCH/);
const mismatchedTomb=b.map(x=>structuredClone(x));mismatchedTomb[2].deleted_at=null;
await assert.rejects(verify(p,mismatchedTomb),/V3_LEGACY_PROVENANCE_DELETION_MISMATCH/);
await assert.rejects(verify(p,b.slice(0,2)),/V3_LEGACY_PROVENANCE_RECORD_COUNT_MISMATCH/);
await assert.rejects(verify([...p,p[0]],b),/V3_LEGACY_PROVENANCE_RECORD_COUNT_MISMATCH/);
await assert.rejects(verify([p[0],p[0]],[b[0],b[1]]),/V3_LEGACY_PROVENANCE_DUPLICATE_ID/);
const wrongId=b.map(x=>structuredClone(x));wrongId[1].payload.id="different";
await assert.rejects(verify(p,wrongId),/V3_LEGACY_PROVENANCE_INVALID_PAYLOAD/);
await assert.rejects(verify([],[]),/V3_LEGACY_PROVENANCE_RECORD_COUNT_MISMATCH/);

const infra=await readFile(new URL("../src/infrastructure/supabase/auditLegacyMediaSources.ts",import.meta.url),"utf8");
const core=await readFile(new URL("../src/core/application/stageLegacyMediaCopies.ts",import.meta.url),"utf8");
const panel=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
assert.match(infra,/account\.auth\.getUser\(\)/);
assert.match(infra,/deriveAccountLinkedLegacyOwnerKey\(settings, userId\)/);
assert.match(infra,/expectedOwnerKey !== ownerKey/);
assert.match(infra,/\.from\("echo_user_profiles"\)/);
assert.match(infra,/profile\.linked_supabase_media_bucket !== BUCKET/);
assert.match(infra,/\.select\("id,payload,deleted_at"\)/);
assert.match(infra,/provider==="personal"\s*\?query\.eq\("owner_key",ownerKey\)\s*:query\.eq\("user_id",userId\)/);
assert.match(infra,/verifyLegacyAccountProvenance\(personalRows,accountRows\)/);
assert.match(infra,/await reverifyLegacyAccountProvenance\?\.\(\)/);
assert.match(infra,/stageLegacyMediaCopies\(ctx\.manifest/);
assert.match(infra,/upsert:false/);
assert.match(infra,/ctx\.account\.storage\.from\(staging\)\.download\(path\)/);
assert.doesNotMatch(infra,/service_role|\.remove\(|\.delete\(|live_memory_v3_activate_/);
assert.match(core,/const path=userId\+match\[1\]/,
  "Generated private path drops blinded legacy-owner segment");
assert.match(panel,/stageLegacyMedia\(\)/);
console.log("Authenticated old ownerKey provenance and immutable private-image staging regression passed.");
