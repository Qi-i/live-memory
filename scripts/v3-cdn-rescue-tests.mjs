import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash,webcrypto} from "node:crypto";
import ts from "typescript";

const source=await readFile(new URL("../supabase/functions/v3-cdn-original-rescue/index.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
let handler;
const UID="11111111-1111-1111-1111-111111111111";
const pic="https://img.alicdn.com/imgextra/test-archive.jpg";
const bad="https://img.alicdn.com/imgextra/not-a-real-photo.jpg";
const bytes=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(90,0x51)]);
const stored=new Map(),rows=new Map();
const sha=data=>createHash("sha256").update(data).digest("hex");
const record=(id,url)=>({
  id,v3_revision:1,payload:{id,title:"Synthetic archive",media:[{
    id:"poster",recordId:id,kind:"poster",src:url,source:"external",
  }],updatedAt:"2026-10-15T00:00:00Z"},
});
rows.set("one",record("one",bad));
rows.set("two",record("two",pic));
const fake={
  auth:{async getUser(){return {data:{user:{id:UID}},error:null};}},
  rpc:async(name,args)=>{
    if(name==="live_memory_v3_mode_account")return {data:"v3",error:null};
    assert.equal(name,"live_memory_v3_cas_secure_account");
    assert.equal(args.p_expected_user,UID);
    const old=rows.get(args.p_id);
    assert.equal(old.v3_revision,args.p_expected_revision);
    assert.equal(args.p_payload.media[0].src,"");
    old.payload=args.p_payload;old.v3_revision++;
    return {data:[old],error:null};
  },
  from(name){
    assert.equal(name,"live_memory_v3_secure_records");
    return {select:()=>({eq:(column,value)=>{
      assert.equal(column,"user_id");assert.equal(value,UID);
      return {order:()=>({limit:async()=>({data:[...rows.values()],error:null})})};
    }})};
  },
  storage:{from(bucket){
    assert.equal(bucket,"echo-v3-media-staging");
    return {
      upload:async(path,blob,options)=>{
        assert.equal(options.upsert,false);
        assert.match(path,new RegExp("^"+UID+"/v3/[a-f0-9]{64}/[a-f0-9]{64}/[a-f0-9]{64}\\.jpg$"));
        stored.set(path,blob);
        return {error:null};
      },
      download:async path=>({data:stored.get(path),error:null}),
    };
  }},
};
const mockedDeno={
  serve:cb=>{handler=cb;},
  env:{get:name=>name==="SUPABASE_URL"?"https://project.test":
    name==="SUPABASE_ANON_KEY"?"public-anon-key":null},
};
const originalFetch=globalThis.fetch;
const imageFetch=async url=>{
  assert.match(url,/^https:\/\/img\.alicdn\.com\//);
  if(url===bad)return new Response("HTML BLOCK",{status:200,
    headers:{"Content-Type":"text/html"}});
  return new Response(bytes,{status:200,headers:{"Content-Type":"image/jpeg"}});
};
try{
  new Function("exports","require","Deno","fetch","crypto",js)(
    {},name=>{
      assert.equal(name,"npm:@supabase/supabase-js@2.53.0");
      return {createClient:()=>fake};
    },mockedDeno,imageFetch,webcrypto,
  );
  assert.equal(typeof handler,"function");
  const req=(value={},auth="Bearer owner-jwt",origin="https://qi-i.github.io")=>
    new Request("https://functions.test/v3-cdn-original-rescue",{
      method:"POST",headers:{"Authorization":auth,"Origin":origin,
        "Content-Type":"application/json"},body:JSON.stringify(value),
    });
  assert.equal((await handler(req({}, ""))).status,401);
  assert.equal((await handler(req({},"Bearer owner","https://evil.example"))).status,403);
  const badResult=await handler(req({limit:1,offset:0}));
  const badBody=await badResult.json();
  assert.deepEqual([badBody.recovered,badBody.failed,badBody.remaining,badBody.nextOffset],
    [0,1,2,1],"A failed old URL must not block the rest of the inventory");
  const goodResult=await handler(req({limit:1,offset:1}));
  const goodBody=await goodResult.json();
  assert.deepEqual([goodBody.recovered,goodBody.failed,goodBody.remaining],
    [1,0,1]);
  const saved=rows.get("two").payload.media[0];
  assert.equal(saved.src,"");
  assert.equal(saved.source,"supabase");
  assert.equal(saved.mimeType,"image/jpeg");
  assert.equal(saved.size,bytes.length);
  assert.equal(saved.storagePath,UID+"/v3/"+sha("two")+"/"+sha("poster")+
    "/"+sha(bytes)+".jpg");
  assert.equal(stored.size,1);
  const repeat=(await handler(req({limit:2,offset:0})));
  const again=await repeat.json();
  assert.equal(again.recovered,0);
  assert.equal(again.failed,1);
  assert.equal(stored.size,1,"Original bytes are immutable and uploads idempotent");
  assert.doesNotMatch(JSON.stringify(again),/imgextra|owner-jwt|Synthetic archive/);
  assert.equal((await handler(req({limit:1,offset:-1}))).status,400);
}finally{globalThis.fetch=originalFetch;}

const ui=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const frontend=await readFile(new URL("../src/infrastructure/supabase/rescueHistoricalCdnOriginals.ts",import.meta.url),"utf8");
assert.match(ui,/rescueHistoricalCdnOriginals\(/);
assert.match(ui,/readyForRescue&&!needsReload/);
assert.match(ui,/runtime\.synchronize\(\{v2AutoSyncDisabled:true\}\)/);
assert.match(frontend,/account|expectedScope/i);
assert.match(frontend,/offset=nextOffset/);
console.log("V3 CDN recovery passed: signed-in RLS, exact owner paths, SHA originals, immutable CAS, blocked hosts and forward progress after failures.");
