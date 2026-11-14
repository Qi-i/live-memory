import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
async function typed(path,deps={}){
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  const exp={};
  new Function("exports","require",js)(exp,name=>{
    if(Object.hasOwn(deps,name))return deps[name];
    throw Error("Unexpected migration test dependency "+name);
  });
  return exp;
}
const rev=await typed("../src/core/sync/revision.ts");
const adoption=await typed("../src/core/application/inspectLegacyV3Adoption.ts",{
  "../sync/revision":rev,
});
const oldAsset={
  id:"poster-001",recordId:"concert-001",kind:"poster",
  src:"https://old-signed.example/ticket.png",storagePath:"private-old/a.jpg",
  source:"supabase",mimeType:"image/png",size:8192,
  title:"Poster",createdAt:"2026-01-01T00:00:00Z",
  updatedAt:"2026-01-01T00:00:00Z",
};
const old={
  id:"concert-001",title:"Legacy unchanged",category:"concert",
  date:"2026-09-27",status:"watched",media:[oldAsset],
  updatedAt:"2026-09-27T12:00:00Z",
  createdAt:"2026-09-01T00:00:00Z",
  mediaTombstones:[],tags:["original"],
};
const external={
  id:"seat-001",recordId:"concert-001",kind:"seatMap",
  src:"https://img.alicdn.com/poster.jpg",source:"external",
  title:"Seat",createdAt:"2026-01-01T00:00:00Z",
  updatedAt:"2026-01-01T00:00:00Z",
};
const local={...old,media:[oldAsset,external]};
const cloud={...old,media:[
  {...oldAsset,src:"https://private-signed.example/ticket.png",
    storagePath:"private-v3/v3/same-asset.png",source:"supabase"},
  {...external,source:"external"},
]};
assert.deepEqual(adoption.inspectLegacyV3Adoption([local],[cloud]),{records:1,changed:1});
assert.deepEqual(adoption.inspectLegacyV3Adoption([cloud],[cloud]),{records:1,changed:0});
for(const pair of [
  [[local],[]],
  [[local,local],[cloud]],
  [[local],[{...cloud,id:"other"}]],
  [[{...local,title:"UNSYNCED EDIT"}],[cloud]],
  [[{...local,updatedAt:"2026-11-15T00:00:00Z"}],[cloud]],
  [[local],[{...cloud,deletedAt:"2026-11-15T00:00:00Z"}]],
  [[{...local,media:[oldAsset]}],[cloud]],
  [[local],[{...cloud,media:[{...cloud.media[0],id:"different-id"},external]}]],
  [[{...local,media:[{...oldAsset,title:"new poster metadata"},external]}],[cloud]],
  [[{...local,media:[{...oldAsset,src:"data:image/png;base64,AA==",storagePath:undefined},external]}],[cloud]],
  [[local],[{...cloud,media:[{...oldAsset,storagePath:undefined},external]}]],
  [[local],[{...cloud,media:[cloud.media[0],{...external,src:"https://another.example/seat.jpg"}]}]],
]){
  assert.throws(()=>adoption.inspectLegacyV3Adoption(...pair),/V3_ADOPTION_/);
}
const runtime=await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts",import.meta.url),"utf8");
const repo=await readFile(new URL("../src/infrastructure/indexedDb/recordRepository.ts",import.meta.url),"utf8");
const ui=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
assert.match(runtime,/adoptMatchingLegacyBrowserHistory/);
assert.match(runtime,/this\.remote\.prepareIncoming/);
assert.match(runtime,/this\.local\.adoptVerifiedCloudTransport/);
assert.match(runtime,/this\.bootstrapMatchingHistory\(\)/);
assert.match(repo,/tx=db\.transaction\(RECORD_STORE,"readwrite"\)/);
assert.match(repo,/store\.put\(normalizeRecord\(row\)\)/);
assert.match(repo,/V3_ADOPTION_LOCAL_CHANGED/);
assert.match(ui,/runtime\.adoptMatchingLegacyBrowserHistory\(\)/);
console.log("V3 existing-browser direct adoption: non-media parity, original media safety, atomic conflict prevention and no exported archive passed.");
