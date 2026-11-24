import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";

async function load(path,deps={}) {
  const source=await readFile(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exports={};
  new Function("exports","require",js)(exports,name=>{
    if(Object.hasOwn(deps,name))return deps[name];
    throw Error("Unexpected QiHub native dependency: "+name);
  });
  return exports;
}

const fields=await load("../src/infrastructure/qihubNativeMemoryFields.ts");
const revision=await load("../src/core/sync/revision.ts");
const port=await load("../src/core/ports/CloudRecordAdapter.ts");
const {SupabaseV3RecordAdapter}=await load(
  "../src/infrastructure/supabase/V3CloudRecordAdapter.ts",{
    "../../core/sync/revision":revision,
    "../../core/ports/CloudRecordAdapter":port,
  },
);
const owner="11111111-1111-1111-1111-111111111111";
const old={
  schemaVersion:2,id:"record-1",title:"原站演唱会",
  category:"concert",status:"watched",recordState:"normal",
  date:"2026-09-27",time:"19:30",city:"上海",venue:"示例场馆",
  artists:["测试歌手"],lineup:[{name:"测试歌手",role:"artist"}],
  companions:[],tags:[],setlist:[],sourceChannel:"official",
  media:[{id:"poster-1",recordId:"record-1",kind:"poster",src:"",
    storagePath:owner+"/v3/"+ "a".repeat(64)+"/"+"b".repeat(64)+"/"+
      "c".repeat(64)+".jpg"}],
  favorite:false,colors:["#111111","#ffffff"],
  createdAt:"2026-09-01T00:00:00.000Z",
  updatedAt:"2026-11-20T00:00:00.000Z",
};

const edited=fields.composeQiHubMemoryRecord(old,{
  title:"新标题",artists:["艺人甲","艺人乙"],price:699,
  city:"北京",date:"2026-11-20",favorite:true,
});
assert.equal(edited.title,"新标题");
assert.deepEqual(edited.artists,["艺人甲","艺人乙"]);
assert.equal(edited.lineup.length,2);
const guest={...old,lineup:[...old.lineup,{name:"嘉宾",role:"guest"}]};
const withGuest=fields.composeQiHubMemoryRecord(guest,{
  artists:["新的主唱"],
});
assert.deepEqual(withGuest.lineup,[
  {name:"新的主唱",role:"artist"},
  {name:"嘉宾",role:"guest"},
]);
assert.deepEqual(edited.media,old.media);
assert.equal(old.title,"原站演唱会");
for (const invalid of [
  {media:[]},{id:"wrong"},{serverRevision:42},
  {date:"2026-02-30"},{price:-1},{status:"wrong"},
  {title:""},{sourceUrl:"javascript:alert(1)"},
]) {
  assert.throws(()=>fields.composeQiHubMemoryRecord(old,invalid));
}

const rows=new Map([["record-1",{id:"record-1",payload:old,v3_revision:7}]]);
const rpcCalls=[];
let mode="v3";
const fake={
  async rpc(name,args){
    if(name==="live_memory_v3_mode_account")return {data:mode,error:null};
    assert.equal(name,"live_memory_v3_cas_secure_account");
    rpcCalls.push({name,args});
    assert.equal(args.p_expected_user,owner);
    const current=rows.get(args.p_id);
    if((current?.v3_revision??null)!==args.p_expected_revision) {
      return {data:null,error:{message:"V3_SECURE_REVISION_CONFLICT"}};
    }
    const row={id:args.p_id,payload:args.p_payload,
      v3_revision:(current?.v3_revision??0)+1};
    rows.set(row.id,row);
    return {data:row,error:null};
  },
  from(table) {
    assert.equal(table,"live_memory_v3_secure_records");
    return {select:()=>({order:()=>({
      range:async(from,to)=>({
        data:[...rows.values()].slice(from,to+1),error:null,
      }),
    })})};
  },
};
let staged=0;
const adapter=new SupabaseV3RecordAdapter(
  fake,"secure-account","verified-account|full-media",owner,
  {assertScope(){},stage(){staged++;throw Error("NO_MEDIA_UPLOAD_ALLOWED")}},
  async()=>{},
);
const prior={record:old,serverRevision:"7"};
const acknowledged=await adapter.compareAndSwapQiHubMetadata(edited,prior);
assert.equal(acknowledged.serverRevision,"8");
assert.equal(acknowledged.record.title,"新标题");
assert.deepEqual(rpcCalls[0].args.p_payload.media,old.media);
assert.equal(staged,0,"No private originals reuploaded for a text edit");
await assert.rejects(
  adapter.compareAndSwapQiHubMetadata({...edited,media:[]},prior),
  /QIHUB_MEMORY_METADATA_ONLY/,
);
await assert.rejects(
  adapter.compareAndSwapQiHubMetadata(edited,prior),
  error=>error instanceof port.RemoteRevisionChanged,
);
mode="v2";
await assert.rejects(
  adapter.compareAndSwapQiHubMetadata(edited,prior),
  /WRITER_NOT_ACTIVE/,
);
mode="v3";
const created={...edited,id:"record-new",media:[],mediaTombstones:[]};
const inserted=await adapter.compareAndSwapQiHubMetadata(created,null);
assert.equal(inserted.serverRevision,"1");
assert.equal(rpcCalls.at(-1).args.p_expected_revision,null);
console.log("QiHub Live Memory metadata validation and source CAS tests passed.");
