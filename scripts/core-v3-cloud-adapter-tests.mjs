import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const portCode = await readFile(new URL("../src/core/ports/CloudRecordAdapter.ts", import.meta.url),"utf8");
const adapterCode = await readFile(new URL("../src/infrastructure/supabase/V3CloudRecordAdapter.ts", import.meta.url),"utf8");
const transpile = code => ts.transpileModule(code,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const revisionCode = await readFile(new URL("../src/core/sync/revision.ts", import.meta.url), "utf8");
const revisions={};
new Function("exports",transpile(revisionCode))(revisions);
const ports={};
new Function("exports",transpile(portCode))(ports);
const adapter={};
new Function("exports","require",transpile(adapterCode))(adapter, moduleName=>{
  if(moduleName==="../../core/ports/CloudRecordAdapter")return ports;
  if(moduleName==="../../core/sync/revision")return revisions;
  throw Error("Unexpected transport dependency: "+moduleName);
});

const ACCOUNT_A="11111111-1111-1111-1111-111111111111";
const ACCOUNT_B="22222222-2222-2222-2222-222222222222";
class FakeRpc {
  rows=new Map();
  calls=[];
  mode="v2";
  actor=ACCOUNT_A;
  onRpc=null;
  onRange=null;
  from(table) {
    this.calls.push(["select",table]);
    return {select:columns=>{
      assert.equal(columns,"id,payload,v3_revision");
      return {order:(key,options)=>{
        assert.equal(key,"id");
        assert.equal(options.ascending,true);
        return {range:async (start,end)=>{
          if(this.onRange) await this.onRange();
          const sorted=[...this.rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
          return {data:sorted.slice(start,end+1),error:null};
        }};
      }};
    }};
  }
  async rpc(name,args) {
    this.calls.push(["rpc",name,args]);
    if (this.onRpc) await this.onRpc(name,args);
    if(["live_memory_v3_mode_personal","live_memory_v3_mode_account"].includes(name)){
      assert.deepEqual(args,{});
      return {data:this.mode,error:null};
    }
    assert.ok(["live_memory_v3_cas_personal","live_memory_v3_cas_account_scoped"].includes(name));
    if (name === "live_memory_v3_cas_account_scoped" &&
        (!args.p_expected_user || args.p_expected_user !== this.actor)) {
      return {data:null,error:{code:"42501",message:"V3_ACCOUNT_SESSION_CHANGED"}};
    }
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
assert.equal(await personal.writerMode(),"v2");
client.mode="v3";
assert.equal(await personal.writerMode(),"v3");
client.mode="invalid";
await assert.rejects(personal.writerMode(),/V3_SERVER_CUTOVER_UNAVAILABLE/);
client.mode="v2";
await assert.rejects(personal.compareAndSwap(record,null), /V3_MEDIA_UPLOAD_REQUIRED/,
  "Local ticket bytes must never be committed as record JSON before media upload");
await assert.rejects(personal.compareAndSwap({
  ...record,media:[{...record.media[0],src:"https://cdn.example.test/private?token=DO_NOT_STORE"}],
},null),/V3_MEDIA_UPLOAD_REQUIRED/,
  "An expiring external image URL without private Storage backing must never enter cloud JSON");
await assert.rejects(personal.compareAndSwap({
  ...record,media:[{...record.media[0],src:""}],
},null),/V3_MEDIA_UPLOAD_REQUIRED/,
  "A missing picture cannot silently become an incomplete synced record");
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
const accountGuard=async()=>{if(accountClient.actor!==ACCOUNT_A)throw Error("V3_ACCOUNT_SESSION_CHANGED");};
const account=new adapter.SupabaseV3RecordAdapter(
  accountClient,"account","auth-user",ACCOUNT_A,undefined,accountGuard,
);
assert.throws(()=>new adapter.SupabaseV3RecordAdapter(
  new FakeRpc(),"account","auth-user",ACCOUNT_A,
),/V3_ACCOUNT_SCOPE_GUARD_REQUIRED/);
const backup=await account.compareAndSwap(record,null);
assert.deepEqual(backup.record.media,[],"Text cloud must strip private ticket data on write");
assert.equal(accountClient.calls.at(-1)[1],"live_memory_v3_cas_account_scoped");
assert.equal(accountClient.calls.at(-1)[2].p_expected_user,ACCOUNT_A);
assert.equal(account.includeMedia,false);
assert.equal(await account.writerMode(),"v2");
assert.equal((await account.list()).length,1);

// A second login during a pending request cannot turn a previously scoped
// archive into cloud writes for the new user (server and client both check).
const changingAccount=new FakeRpc();
const switchingGuard=async()=>{
  if(changingAccount.actor!==ACCOUNT_A)throw Error("V3_ACCOUNT_SESSION_CHANGED");
};
const guardedAccount=new adapter.SupabaseV3RecordAdapter(
  changingAccount,"account","auth-user",ACCOUNT_A,undefined,switchingGuard,
);
changingAccount.onRpc=async(name)=>{
  if(name==="live_memory_v3_cas_account_scoped") changingAccount.actor=ACCOUNT_B;
};
await assert.rejects(guardedAccount.compareAndSwap({...record,media:[]},null),
  /V3_ACCOUNT_SESSION_CHANGED/);
assert.equal(changingAccount.rows.size,0,
  "An in-flight auth switch must not write the former account's archive under the new JWT");
changingAccount.onRpc=null;
changingAccount.actor=ACCOUNT_A;
changingAccount.onRange=async()=>{changingAccount.actor=ACCOUNT_B;};
await assert.rejects(guardedAccount.list(),/V3_ACCOUNT_SESSION_CHANGED/,
  "Switching identity during an inventory page must abort the entire read");
changingAccount.onRange=null;
changingAccount.actor=ACCOUNT_A;
const oldMode=changingAccount.mode;
changingAccount.onRpc=async(name)=>{
  if(name==="live_memory_v3_mode_account") changingAccount.actor=ACCOUNT_B;
};
await assert.rejects(guardedAccount.writerMode(),/V3_ACCOUNT_SESSION_CHANGED/,
  "A stale mode check must never authorize writes after a login change");
changingAccount.mode=oldMode;

// The adapter must fetch every page; a provider limit cannot erase archives.
const many=new FakeRpc();
for(let index=0; index<1007; index++){
  const id="bulk-"+String(index).padStart(4,"0");
  many.rows.set(id,{id,payload:{...record,id,media:[]},v3_revision:1});
}
const all=await new adapter.SupabaseV3RecordAdapter(
  many,"account","auth-user",ACCOUNT_A,undefined,
  async()=>{if(many.actor!==ACCOUNT_A)throw Error("V3_ACCOUNT_SESSION_CHANGED");},
).list();
assert.equal(all.length,1007,"Every record across 3 server pages must be returned");
assert.equal(new Set(all.map(row=>row.record.id)).size,1007);

// Concurrent V2 uploads can shift offset pages or change revisions while V3
// enumerates cloud records. Neither result is a safe deletion signal.
const insertedDuringRead = new FakeRpc();
insertedDuringRead.rows.set("one", {id:"one",payload:{...record,id:"one",media:[]},v3_revision:1});
const originalInsertedFrom = insertedDuringRead.from.bind(insertedDuringRead);
let insertionReads = 0;
insertedDuringRead.from = (table) => {
  insertionReads += 1;
  if (insertionReads === 2) insertedDuringRead.rows.set("two", {
    id:"two",payload:{...record,id:"two",media:[]},v3_revision:1,
  });
  return originalInsertedFrom(table);
};
await assert.rejects(new adapter.SupabaseV3RecordAdapter(
  insertedDuringRead,"account","test-user",ACCOUNT_A,undefined,
  async()=>{if(insertedDuringRead.actor!==ACCOUNT_A)throw Error("V3_ACCOUNT_SESSION_CHANGED");},
).list(), /V3_REMOTE_INVENTORY_CHANGED/,
"Records inserted between scans must fail closed rather than silently being omitted");

const editedDuringRead = new FakeRpc();
editedDuringRead.rows.set("one", {id:"one",payload:{...record,id:"one",media:[]},v3_revision:1});
const originalEditedFrom = editedDuringRead.from.bind(editedDuringRead);
let editReads = 0;
editedDuringRead.from = (table) => {
  editReads += 1;
  if (editReads === 2) editedDuringRead.rows.set("one", {
    id:"one",payload:{...record,id:"one",title:"A concurrent V2 edit",media:[]},v3_revision:2,
  });
  return originalEditedFrom(table);
};
await assert.rejects(new adapter.SupabaseV3RecordAdapter(
  editedDuringRead,"account","test-user",ACCOUNT_A,undefined,
  async()=>{if(editedDuringRead.actor!==ACCOUNT_A)throw Error("V3_ACCOUNT_SESSION_CHANGED");},
).list(), /V3_REMOTE_INVENTORY_CHANGED/,
"Legacy V2 writes during V3 inventory must trigger retry");

const missingRevision=new FakeRpc();
missingRevision.rows.set(record.id,{id:record.id,payload:record});
await assert.rejects(new adapter.SupabaseV3RecordAdapter(
  missingRevision,"personal","owner-test","account-test",
).list(),/version/i,"Old schema cannot be silently treated as CAS-capable");
assert.doesNotMatch(adapterCode, /\.upsert\(|\.delete\(/,
  "V3 cloud adapter cannot fall back to an unconditional public write");
console.log("V3 cloud transport tests passed: CAS revisions, stale-write rejection, local-byte guard, signed-URL stripping, account privacy, schema fail-close, concurrent inventory drift detection.");
