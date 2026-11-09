import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(relative, modules = {}) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  new Function("exports", "require", js)(exports, name => {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error("Unexpected V3 media dependency: " + name);
  });
  return { exports, source };
}
const transportModule = await load("../src/infrastructure/supabase/V3MediaTransport.ts");
const rev = await load("../src/core/sync/revision.ts");
const ports = await load("../src/core/ports/CloudRecordAdapter.ts");
const adapter = await load("../src/infrastructure/supabase/V3CloudRecordAdapter.ts", {
  "../../core/sync/revision": rev.exports,
  "../../core/ports/CloudRecordAdapter": ports.exports,
});

const owner = "c".repeat(64);
const mediaFolder = createHash("sha256").update("live-memory-v3-media:" + owner).digest("hex");
const mediaBytes = Buffer.from("SYNTHETIC PNG STUB ONLY; NEVER REAL PERSONAL DATA");
const dataURL = "data:image/png;base64," + mediaBytes.toString("base64");
const first = {
  schemaVersion:2, id:"synthetic-show", title:"Private synthetic test",
  date:"2026-11-09", city:"Test", media:[{
    id:"synthetic-poster", recordId:"synthetic-show", kind:"poster",
    src:dataURL, source:"local", mimeType:"image/png",
  }],
};
const copy = value => structuredClone(value);
class FakeServer {
  objects = new Map();
  legacyObjects = new Map();
  rows = new Map();
  staged = [];
  rpcCalls = [];
  failUpload = false;
  failSign = false;
  conflictingObject = false;
  storage = {
    from: bucket => {
      assert.ok(["echo-private-media-v3","echo-media"].includes(bucket));
      const objects = bucket === "echo-media" ? this.legacyObjects : this.objects;
      return {
        upload: async(path, body, options) => {
          assert.equal(options.upsert,false,"Immutable object cannot replace earlier files");
          assert.equal(bucket,"echo-private-media-v3","Never upload into the legacy public bucket");
          this.staged.push(path);
          if (this.failUpload) return {error:{message:"offline",statusCode:503}};
          if (objects.has(path)) return {error:{message:"Already exists",statusCode:409}};
          objects.set(path,body);
          return {error:null};
        },
        download: async path => {
          if (this.conflictingObject) return {data:new Blob(["CORRUPTED"],{type:"image/png"}),error:null};
          return objects.has(path) ? {data:objects.get(path),error:null} : {data:null,error:{message:"not found"}};
        },
        createSignedUrl: async(path,seconds) => {
          assert.equal(seconds,3600);
          if(this.failSign) return {data:null,error:{message:"private URL failure"}};
          return objects.has(path)
            ? {data:{signedUrl:"https://signed.example/"+bucket+"/bytes/"+encodeURIComponent(path)},error:null}
            : {data:null,error:{message:"no such image"}};
        },
      };
    },
  };
  from(name) {
    assert.equal(name,"echo_passkey_records");
    return {select:fields=>{
      assert.equal(fields,"id,payload,v3_revision");
      return {order:(_name,_opts)=>({range: async(start,end)=>({
        data:[...this.rows.values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(start,end+1).map(copy),
        error:null,
      })})};
    }};
  }
  async rpc(name,args) {
    assert.equal(name,"live_memory_v3_cas_personal");
    this.rpcCalls.push(copy(args));
    const row=this.rows.get(args.p_id);
    if ((row?.v3_revision??null)!==args.p_expected_revision) {
      return {data:null,error:{message:"V3_REVISION_CONFLICT",code:"P0001"}};
    }
    const updated={id:args.p_id,payload:copy(args.p_payload),v3_revision:(row?.v3_revision??0)+1};
    this.rows.set(args.p_id,updated);
    return {data:copy(updated),error:null};
  }
}
const server=new FakeServer();
let scope="user-a";
const media = new transportModule.exports.SupabaseV3MediaTransport(
  server,"echo-private-media-v3",owner,()=>{if(scope!=="user-a")throw Error("V3_MEDIA_ACCOUNT_CHANGED");},
  async asset=>asset.src,
);
assert.throws(() => new transportModule.exports.SupabaseV3MediaTransport(
  server,"echo-media",owner,()=>{},async asset=>asset.src,
), /V3_MEDIA_INVALID_SCOPE_OR_BUCKET/,
  "V3 MUST refuse the legacy public bucket even if settings request it");
const cloud=new adapter.exports.SupabaseV3RecordAdapter(
  server,"personal","personal-owner-test","user-a",media,
);
const committed=await cloud.compareAndSwap(first,null);
assert.equal(committed.serverRevision,"1");
assert.equal(server.rpcCalls.length,1);
assert.equal(server.staged.length,1);
const path=server.staged[0];
assert.match(path,new RegExp("^"+mediaFolder+"/v3/[a-f0-9]{64}/[a-f0-9]{64}/[a-f0-9]{64}\\.png$"));
assert.equal(path.includes(owner),false,"Never reveal the owner authorization key in a private URL or object name");
assert.equal(server.rpcCalls[0].p_payload.media[0].src,"",
  "Cloud JSON must never include raw tickets or private image bytes");
assert.equal(server.rpcCalls[0].p_payload.media[0].storagePath,path);
assert.equal(committed.record.media[0].src,dataURL,
  "Successful CAS must retain the original image bytes for local rendering");
assert.equal(committed.record.media[0].storagePath,path);

const hydrated=await cloud.list();
assert.equal(hydrated.length,1);
assert.ok(hydrated[0].record.media[0].src.startsWith("https://signed.example/"),
  "Second device must receive a renderable private URL");
assert.equal(await rev.exports.recordRevision(hydrated[0].record,true),
  await rev.exports.recordRevision(committed.record,true),
  "Rotating signed URLs must not cause a spurious conflict");

const second=await cloud.compareAndSwap(first,"1");
assert.equal(second.serverRevision,"2");
assert.equal(server.objects.size,1,"Retry must reuse the same immutable content-addressed path");
assert.equal(server.staged.length,2);
assert.equal(server.rpcCalls.length,2);

// A competing device can win CAS after the image stages. The losing device
// must not touch either the committed JSON or the original private media.
await assert.rejects(cloud.compareAndSwap({...first,title:"stale overwrite"},"1"),
  error=>error instanceof ports.exports.RemoteRevisionChanged);
assert.equal(server.rows.get(first.id).payload.title,first.title);
assert.equal(server.objects.size,1);
assert.equal(server.rpcCalls.length,3);

server.conflictingObject=true;
await assert.rejects(cloud.compareAndSwap(first,"2"),/V3_MEDIA_EXISTING_OBJECT_MISMATCH/);
assert.equal(server.rpcCalls.length,3,"Hash mismatch may never trigger metadata CAS");
server.conflictingObject=false;

server.failSign=true;
await assert.rejects(cloud.list(),/V3_MEDIA_SIGNING_FAILED/);
server.failSign=false;

server.failUpload=true;
const fresh={...first,media:[{...first.media[0],id:"second",src:"data:image/png;base64,"+Buffer.from("different").toString("base64")}]};
await assert.rejects(cloud.compareAndSwap(fresh,"2"),/V3_MEDIA_STAGE_FAILED/);
assert.equal(server.rpcCalls.length,3,"Failed media upload must not commit a metadata-only record");
server.failUpload=false;

const foreign={...first.media[0],src:"",storagePath:"other-owner/private.jpg"};
await assert.rejects(media.stage(first.id,foreign),/V3_MEDIA_FOREIGN_OR_INVALID_PATH/);
const leaked={...first.media[0],src:"",storagePath:owner+"/v3/synthetic/private.webp"};
await assert.rejects(media.stage(first.id,leaked),/V3_MEDIA_FOREIGN_OR_INVALID_PATH/,
  "Reject historical secret-bearing V3-style object paths");
const mismatched={...first.media[0],recordId:"different-record"};
await assert.rejects(media.stage(first.id,mismatched),/V3_MEDIA_RECORD_ID_MISMATCH/);
scope="user-b";
await assert.rejects(cloud.compareAndSwap(first,"2"),/V3_MEDIA_ACCOUNT_CHANGED/);
assert.equal(server.rpcCalls.length,3,"Account switches must stop remote writes");
scope="user-a";

// Existing V2 cloud records may have old storage paths. They can be signed,
// but cannot be overwritten in place by the V3 media pipeline.
const legacy={...first,id:"legacy-show",media:[{...first.media[0],
  recordId:"legacy-show",src:"",storagePath:owner+"/legacy/show/poster.png"}]};
server.legacyObjects.set(legacy.media[0].storagePath,new Blob([mediaBytes],{type:"image/png"}));
server.rows.set("legacy-show",{id:"legacy-show",payload:copy(legacy),v3_revision:1});
const afterLegacy=await cloud.list();
assert.ok(afterLegacy.find(e=>e.record.id==="legacy-show")?.record.media[0].src.includes("/echo-media/"),
  "Old records still need to display their original V2 media in a read-only audit");
assert.equal(server.staged.length,5,"Read-only signed restoration cannot upload media");
const migrated=await cloud.compareAndSwap(legacy,"1");
assert.equal(migrated.serverRevision,"2");
assert.ok(migrated.record.media[0].storagePath.startsWith(mediaFolder+"/v3/"));
assert.equal(migrated.record.media[0].storagePath.includes(owner),false);
assert.ok(migrated.record.media[0].src.includes("/echo-private-media-v3/"));
assert.equal(server.legacyObjects.size,1,"V3 migration must NEVER delete V2 original objects");
assert.equal(server.objects.size,2,"V3 stores an independent immutable copy");
assert.equal(server.staged.length,6);
assert.ok((await cloud.list()).find(e=>e.record.id==="legacy-show")?.record.media[0].src.includes("/echo-private-media-v3/"));

// URL-only posters have no durable private backing. Fetch CORS-safe image
// bytes and store a private copy; NEVER commit an expiring external token.
const originalFetch = globalThis.fetch;
try {
  const urlRecord = {...first,id:"external-show",media:[{
    ...first.media[0],id:"external-poster",recordId:"external-show",
    src:"https://cdn.example.test/poster?token=DO_NOT_STORE",
  }]};
  globalThis.fetch = async (input, options) => {
    assert.equal(options?.credentials,"omit");
    assert.equal(options?.mode,"cors");
    if(String(input)!==urlRecord.media[0].src)throw new TypeError("synthetic network outage");
    return new Response(new Blob([mediaBytes],{type:"image/png"}),{status:200});
  };
  const committedURL=await cloud.compareAndSwap(urlRecord,null);
  assert.equal(committedURL.serverRevision,"1");
  assert.ok(committedURL.record.media[0].storagePath.startsWith(mediaFolder+"/v3/"));
  assert.ok(committedURL.record.media[0].src.includes("/echo-private-media-v3/"),
    "A staged remote poster must immediately render using its new private signed URL");
  assert.equal(committedURL.record.media[0].src.includes("DO_NOT_STORE"),false);
  assert.equal(server.rows.get("external-show").payload.media[0].src,"");
  assert.equal(JSON.stringify(server.rpcCalls.at(-1).p_payload).includes("DO_NOT_STORE"),false,
    "Never save external query tokens to cloud JSON");

  const beforeFailedURL=server.rpcCalls.length;
  globalThis.fetch=async()=>{throw new TypeError("CORS blocked")};
  await assert.rejects(cloud.compareAndSwap({
    ...urlRecord,id:"unrecoverable-show",media:[{...urlRecord.media[0],recordId:"unrecoverable-show"}],
  },null),/V3_MEDIA_SOURCE_UNAVAILABLE/);
  assert.equal(server.rpcCalls.length,beforeFailedURL,
    "An external image that cannot be recovered must block the entire record CAS");
  await assert.rejects(media.stage("unrecoverable-show",{
    ...urlRecord.media[0],recordId:"unrecoverable-show",src:"http://insecure.example/unknown.png",
  }),/V3_MEDIA_NONPORTABLE_URL/);
  await assert.rejects(cloud.compareAndSwap({
    ...urlRecord,id:"missing-show",media:[{
      ...urlRecord.media[0],recordId:"missing-show",src:"",
    }],
  },null),/V3_MEDIA_SOURCE_UNAVAILABLE/);
  assert.equal(server.rpcCalls.length,beforeFailedURL);
} finally {
  globalThis.fetch=originalFetch;
}

const runtime=await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts",import.meta.url),"utf8");
assert.match(runtime,/new SupabaseV3MediaTransport\(/);
assert.match(runtime,/V3_PRIVATE_MEDIA_BUCKET/);
assert.doesNotMatch(runtime,/personal as unknown as V3MediaStorageClient,\s*settings\.supabase\.mediaBucket/);
assert.match(runtime,/resolveMediaSource\(asset, true\)/);
assert.match(runtime,/new SupabaseV3RecordAdapter\(client, provider, identity, scope, mediaTransport\)/);
assert.doesNotMatch(transportModule.source,/\.remove\(|\.delete\(|upsert:\s*true/,
  "Never delete staged content immediately after CAS failure");
console.log("V3 private media tests passed: immutable upload, original local bytes, remote signed restore, CAS race, tamper, owner scope and failure abort.");
