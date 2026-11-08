import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const portCode = await readFile(new URL("../src/core/ports/CloudRecordAdapter.ts", import.meta.url),"utf8");
const adapterCode = await readFile(new URL("../src/infrastructure/supabase/V3CloudRecordAdapter.ts", import.meta.url),"utf8");
const transpile = code => ts.transpileModule(code,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const ports={};
new Function("exports",transpile(portCode))(ports);
const adapter={};
new Function("exports","require",transpile(adapterCode))(adapter, moduleName=>{
  if(moduleName==="../../core/ports/CloudRecordAdapter")return ports;
  throw Error("Unexpected transport dependency: "+moduleName);
});

class FakeRpc {
  rows=new Map();
  calls=[];
  from(table) {
    this.calls.push(["select",table]);
    return {select:async columns=>{
      assert.equal(columns,"id,payload,v3_revision");
      return {data:[...this.rows.values()],error:null};
    }};
  }
  async rpc(name,args) {
    this.calls.push(["rpc",name,args]);
    assert.ok(["live_memory_v3_cas_personal","live_memory_v3_cas_account"].includes(name));
    const old=this.rows.get(args.p_id);
    const expected=old?.v3_revision??null;
    if(expected!==args.p_expected_revision)
      return {data:null,error:{code:"P0001",message:"V3_REVISION_CONFLICT"}};
    const next={id:args.p_id,payload:structuredClone(args.p_payload),v3_revision:(expected??0)+1};
    this.rows.set(args.p_id,next);
    return {data:next,error:null};
  }
}
const record={
  id:"show-one",title:"旧现场",artists:[],date:"2026-09-27",city:"北京",
  media:[{id:"private-ticket",kind:"ticket",src:"data:image/png;base64,PRIVATE"}],
};
const client=new FakeRpc();
const personal=new adapter.SupabaseV3RecordAdapter(client,"personal","owner-test","account-test");
assert.equal(personal.includeMedia,true);
await assert.rejects(personal.compareAndSwap(record,null), /V3_MEDIA_UPLOAD_REQUIRED/,
  "Local ticket bytes must never be committed as record JSON before media upload");
const uploadedRecord = { ...record, media: [{
  ...record.media[0], storagePath:"test/record-one/ticket.png",
  src:"https://storage.example/signed-private?token=SECRET"
}] };
const first=await personal.compareAndSwap(uploadedRecord,null);
assert.equal(first.serverRevision,"1");
assert.equal(first.record.media.length,1);
assert.equal(first.record.media[0].src,"", "Rotating private signed URLs must not be sent to cloud JSON");
const next=await personal.compareAndSwap({...uploadedRecord,title:"已修改"},first.serverRevision);
assert.equal(next.serverRevision,"2");
assert.equal(next.record.title,"已修改");
await assert.rejects(personal.compareAndSwap({...uploadedRecord,title:"旧窗口误覆盖"},"1"),
  e=>e instanceof ports.RemoteRevisionChanged,
  "Server CAS must refuse old-tab edits instead of silently overwriting");
assert.equal((await personal.list())[0].record.title,"已修改");
await assert.rejects(personal.compareAndSwap(record,"unsafe"),/Invalid server revision/);

const accountClient=new FakeRpc();
const account=new adapter.SupabaseV3RecordAdapter(accountClient,"account","auth-user","account-test");
const backup=await account.compareAndSwap(record,null);
assert.deepEqual(backup.record.media,[],"Text cloud must strip private ticket data on write");
assert.equal(accountClient.calls.at(-1)[1],"live_memory_v3_cas_account");
assert.equal(account.includeMedia,false);
assert.equal((await account.list()).length,1);

const missingRevision=new FakeRpc();
missingRevision.rows.set(record.id,{id:record.id,payload:record});
await assert.rejects(new adapter.SupabaseV3RecordAdapter(
  missingRevision,"personal","owner-test","account-test",
).list(),/version/i,"Old schema cannot be silently treated as CAS-capable");
assert.doesNotMatch(adapterCode, /\.upsert\(|\.delete\(/,
  "V3 cloud adapter cannot fall back to an unconditional public write");
console.log("V3 cloud transport tests passed: CAS revisions, stale-write rejection, local-byte guard, signed-URL stripping, account privacy, schema fail-close.");
