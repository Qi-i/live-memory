import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import ts from "typescript";
async function load(path,deps={}){
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const result={};
  new Function("exports","require",js)(result,name=>{
    if(Object.hasOwn(deps,name))return deps[name];
    throw Error("Unexpected secure media dependency: "+name);
  });
  return result;
}
const rev=await load("../src/core/sync/revision.ts");
const port=await load("../src/core/ports/CloudRecordAdapter.ts");
const cloudModule=await load("../src/infrastructure/supabase/V3CloudRecordAdapter.ts",{
  "../../core/sync/revision":rev,
  "../../core/ports/CloudRecordAdapter":port,
});
const transportModule=await load("../src/infrastructure/supabase/V3AuthenticatedMediaTransport.ts");
const uuid="11111111-1111-1111-1111-111111111111",foreign="22222222-2222-2222-2222-222222222222";
const sourceBytes=Buffer.from("SYNTHETIC ARCHIVED PRIVATE MEDIA");
const sourceURL="data:image/png;base64,"+sourceBytes.toString("base64");
const sha=text=>createHash("sha256").update(text).digest("hex");
const saved=new Map(),cache=new Map(),rpcCalls=[],uploads=[],downloads=[];
let actor=uuid,failDownload=false,corruptDownload=false,failSign=false;
const fake={
  storage:{from(bucket){
    assert.equal(bucket,"echo-v3-media-staging");
    return {
      async upload(path,blob,options){
        uploads.push(path);
        assert.equal(options.upsert,false);
        if(saved.has(path))return {error:{statusCode:"409",message:"Already exists"}};
        saved.set(path,blob);return {error:null};
      },
      async download(path){
        downloads.push(path);
        if(failDownload)return {data:null,error:{message:"Network down"}};
        if(corruptDownload)return {data:new Blob(["WRONG"],{type:"image/png"}),error:null};
        return {data:saved.get(path)||null,error:saved.has(path)?null:{message:"missing"}};
      },
      async createSignedUrl(path,seconds){
        assert.equal(seconds,3600);
        if(failSign)return {data:null,error:{message:"Forbidden"}};
        return saved.has(path)?{data:{signedUrl:"https://signed.test/"+encodeURIComponent(path)},error:null}:
          {data:null,error:{message:"not found"}};
      },
    };
  }},
  from(table){
    assert.equal(table,"live_memory_v3_secure_records");
    return {select(fields){
      assert.equal(fields,"id,payload,v3_revision");
      return {order(column,{ascending}){
        assert.equal(column,"id");assert.equal(ascending,true);
        return {range:async(from,to)=>({data:[...fake.rows.values()]
          .sort((a,b)=>a.id.localeCompare(b.id)).slice(from,to+1),error:null})};
      }};
    }};
  },
  rows:new Map(),
  async rpc(name,args){
    rpcCalls.push({name,args:structuredClone(args)});
    if(name==="live_memory_v3_mode_account")return {data:"v2",error:null};
    assert.equal(name,"live_memory_v3_cas_secure_account");
    if(args.p_expected_user!==actor)return {data:null,error:{message:"V3_SECURE_ACCOUNT_CHANGED",code:"42501"}};
    const row=this.rows.get(args.p_id);
    if((row?.v3_revision??null)!==args.p_expected_revision)
      return {data:null,error:{message:"V3_SECURE_REVISION_CONFLICT",code:"P0001"}};
    const next={id:args.p_id,payload:structuredClone(args.p_payload),
      v3_revision:(row?.v3_revision??0)+1};
    this.rows.set(args.p_id,next);
    return {data:next,error:null};
  },
};
let scope=uuid;
const check=()=>{if(scope!==uuid)throw Error("V3_ACCOUNT_SESSION_CHANGED")};
const media=new transportModule.SupabaseV3AccountMediaTransport(
  fake,uuid,check,async asset=>asset.src,
  async(asset,blob)=>cache.set(asset.storagePath,Buffer.from(await blob.arrayBuffer())),
  async asset=>cache.has(asset.storagePath),
);
const record={schemaVersion:2,id:"concert-1",title:"Synthetic",
  date:"2026-09-27",media:[{id:"poster-1",recordId:"concert-1",
    src:sourceURL,kind:"poster",mimeType:"image/png",source:"local"}]};
const account=new cloudModule.SupabaseV3RecordAdapter(
  fake,"secure-account","account-test|full-media",uuid,media,async()=>{
    if(actor!==uuid)throw Error("V3_ACCOUNT_SESSION_CHANGED");
  },
);
assert.equal(account.includeMedia,true);
assert.equal(await account.writerMode(),"v2");
const committed=await account.compareAndSwap(record,null);
assert.equal(committed.serverRevision,"1");
assert.equal(committed.record.media.length,1);
assert.equal(committed.record.media[0].src,sourceURL,
  "Keep displayable original image source after successful CAS");
const path=committed.record.media[0].storagePath;
assert.equal(path,uuid+"/v3/"+sha("concert-1")+"/"+sha("poster-1")+
  "/"+sha(sourceBytes)+".png");
assert.equal(fake.rows.get("concert-1").payload.media[0].src,"",
  "Server may receive no data URL, ticket bytes or signed token");
assert.equal(saved.size,1);
assert.deepEqual(cache.get(path),sourceBytes);
assert.equal(rpcCalls[1].name,"live_memory_v3_cas_secure_account");
assert.equal(rpcCalls[1].args.p_expected_user,uuid);
assert.ok(fake.rows.get("concert-1").payload.media[0].storagePath===path);
const hydrated=await account.list();
assert.equal(hydrated[0].record.media[0].storagePath,path);
assert.match(hydrated[0].record.media[0].src,/^https:\/\/signed\.test\//);
assert.equal(await rev.recordRevision(hydrated[0].record,true),
  await rev.recordRevision(committed.record,true));
cache.clear();
await account.prepareIncoming(hydrated[0].record);
assert.deepEqual(cache.get(path),sourceBytes);
const before=downloads.length;
await account.prepareIncoming(hydrated[0].record);
assert.equal(downloads.length,before,"Verified private offline image must not redownload");

await assert.rejects(account.compareAndSwap({...record,title:"stale"},null),
  error=>error instanceof port.RemoteRevisionChanged);
assert.equal(fake.rows.get("concert-1").payload.title,"Synthetic");

const legacy={...record.media[0],storagePath:"a".repeat(64)+"/old-public.jpg"};
const migrated=await media.stage(record.id,legacy);
assert.equal(migrated.storagePath,path,
  "A legacy public Storage object must be reuploaded as immutable JWT-scoped media");
assert.equal(saved.size,1);
await assert.rejects(media.hydrate({...record,media:[{
  ...record.media[0],storagePath:foreign+"/v3/"+sha("concert-1")+
    "/"+sha("poster-1")+"/"+sha(sourceBytes)+".png",
}]}),/V3_ACCOUNT_MEDIA_INVALID_PATH/);
cache.clear();
failDownload=true;
await assert.rejects(account.prepareIncoming(hydrated[0].record),/V3_ACCOUNT_MEDIA_DOWNLOAD_FAILED/);
failDownload=false;corruptDownload=true;
await assert.rejects(account.prepareIncoming(hydrated[0].record),/V3_ACCOUNT_MEDIA_DOWNLOAD_FAILED/);
corruptDownload=false;
scope=foreign;
await assert.rejects(account.prepareIncoming(hydrated[0].record),/V3_ACCOUNT_SESSION_CHANGED/);
scope=uuid;
actor=foreign;
await assert.rejects(account.compareAndSwap({...record,media:[]},null),/V3_ACCOUNT_SESSION_CHANGED/);
actor=uuid;

const runtime=await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts",import.meta.url),"utf8");
const workspace=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const adapterSource=await readFile(new URL("../src/infrastructure/supabase/V3CloudRecordAdapter.ts",import.meta.url),"utf8");
assert.match(runtime,/provider === "secure-account"/);
assert.match(runtime,/new SupabaseV3AccountMediaTransport/);
assert.match(runtime,/\|full-media/);
assert.match(workspace,/createV3SyncRuntime\(readSettings\(\),"secure-account"\)/);
assert.match(adapterSource,/live_memory_v3_secure_records/);
assert.match(adapterSource,/live_memory_v3_cas_secure_account/);
assert.doesNotMatch(workspace,/createV3SyncRuntime\(readSettings\(\),"account"\)/);
console.log("V3 authenticated media sync passed: full poster CAS, SHA staging, signed recovery, cache, legacy migration and cross-account fences.");
