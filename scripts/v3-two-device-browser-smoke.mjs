import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * Two wholly independent Chromium profiles, real IndexedDB archives,
 * real V3 revision ledgers and application synchronization.
 * The shared fake CAS server lives in this test process. There are NO
 * Supabase keys, network writes, production accounts, or remote images.
 */
const base=process.env.V3_TWO_DEVICE_URL||"http://127.0.0.1:5173/live-memory/";
const origin=new URL(base).origin;
const copy=v=>structuredClone(v);
const server=new Map();
let offline=false;
let raceNextCAS=false;
let casCalls=0;
const cloudService=async(request)=>{
  const {action,record,expected}=request;
  if(offline)throw Error("SYNTHETIC_OFFLINE");
  if(action==="list")return {records:copy([...server.values()])};
  if(action!=="cas")throw Error("Unknown mock CAS operation");
  casCalls+=1;
  const existing=server.get(record.id);
  if(raceNextCAS) {
    raceNextCAS=false;
    if(existing)server.set(record.id,{
      record:{...existing.record,title:"Remote concurrent winner"},
      serverRevision:String(Number(existing.serverRevision)+1),
    });
  }
  const before=server.get(record.id);
  if((before?.serverRevision??null)!==expected)return {conflict:true};
  const next={record:copy(record),serverRevision:String(Number(before?.serverRevision??0)+1)};
  server.set(record.id,next);
  return {envelope:copy(next)};
};

const fixture=(id,title)=>({
  schemaVersion:2,id,title,date:"2026-09-27",category:"concert",
  status:"watched",recordState:"normal",city:"北京",venue:"合成测试场馆",
  artists:["合成测试艺人"],lineup:[],companions:[],tags:[],setlist:[],
  sourceChannel:"",media:id==="concert-1"?[{
    id:"media-concert-1",recordId:id,kind:"poster",title:"合成测试原图",
    src:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2VUdMAAAAASUVORK5CYII=",
    source:"local",mimeType:"image/png",
  }]:[],favorite:false,colors:["#6671ab","#d2e2f2"],
  createdAt:"2026-09-27T00:00:00.000Z",
  updatedAt:"2026-09-27T00:00:00.000Z",
});
const browser=await chromium.launch({headless:true});
const contexts=[];
const pages=[];
const outside=[];
try {
  for(const label of ["device-A","device-B"]) {
    const context=await browser.newContext({
      viewport:{width:label==="device-A"?1280:390,height:860},
      serviceWorkers:"block",
    });
    contexts.push(context);
    await context.addInitScript(()=>{
      localStorage.setItem("live-memory-device-only-v1","1");
    });
    await context.route("**/*",route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin)return route.continue();
      outside.push(url.hostname);
      return route.abort();
    });
    const page=await context.newPage();
    pages.push(page);
    page.on("pageerror",error=>{throw Error(label+": "+error.message)});
    await page.exposeFunction("__v3TestCloud",cloudService);
    const response=await page.goto(base,{waitUntil:"domcontentloaded"});
    assert.equal(response?.status(),200,label+" test server unavailable");
    await page.evaluate(async()=>{
      const {setStorageScope}=await import("/live-memory/src/storage.ts");
      setStorageScope("device-local");
      const {IndexedDbRecordRepository}=await import(
        "/live-memory/src/infrastructure/indexedDb/recordRepository.ts"
      );
      const {IndexedDbRevisionLedger}=await import(
        "/live-memory/src/infrastructure/indexedDb/revisionLedger.ts"
      );
      const {RemoteRevisionChanged}=await import(
        "/live-memory/src/core/ports/CloudRecordAdapter.ts"
      );
      const {synchronizeWithLedger}=await import(
        "/live-memory/src/core/application/synchronizeWithLedger.ts"
      );
      const {V3SyncRuntime}=await import(
        "/live-memory/src/infrastructure/createV3SyncRuntime.ts"
      );
      const {listProtectedConflictVersions,readProtectedConflictVersion} = await import(
        "/live-memory/src/infrastructure/indexedDb/v3ConflictVault.ts"
      );
      const local=new IndexedDbRecordRepository("device-local");
      const ledger=await IndexedDbRevisionLedger.create(
        "device-local","personal","isolated-v3-test-server"
      );
      const cloud={
        provider:"personal",accountScope:"device-local",
        identity:"isolated-v3-test-server",includeMedia:true,
        writerMode:async()=> "v3",
        prepareIncoming:async record=>record,
        list:async()=>{const reply=await window.__v3TestCloud({action:"list"});return reply.records;},
        compareAndSwap:async(record,expected)=>{
          const reply=await window.__v3TestCloud({action:"cas",record,expected});
          if(reply.conflict)throw new RemoteRevisionChanged();
          return reply.envelope;
        },
      };
      window.__v3Test={
        list:()=>local.list(),
        save:(row,old)=>local.saveIfUnchanged(row,old),
        sync:()=>synchronizeWithLedger(local,cloud,ledger),
        ledger:()=>ledger.snapshot().then(items=>[...items]),
        preview:(id)=>new V3SyncRuntime(local,cloud,ledger).previewConflict(id),
        resolve:(entry,choice)=>new V3SyncRuntime(local,cloud,ledger).resolveConflict(entry,choice),
        vault:()=>listProtectedConflictVersions("device-local"),
        vaultRow:(key)=>readProtectedConflictVersion("device-local",key).then(row=>row && ({
          title:row.record.title,savedSide:row.savedSide,
          mediaCount:row.assets.length,bytes:row.assets.map(item=>item.bytes.size),
        })),
      };
    });
  }
  const [A,B]=pages;
  const list=page=>page.evaluate(()=>window.__v3Test.list());
  const ledger=page=>page.evaluate(()=>window.__v3Test.ledger());
  const sync=page=>page.evaluate(()=>window.__v3Test.sync());
  const save=(page,row,opened)=>page.evaluate(
    ({row,opened})=>window.__v3Test.save(row,opened),{row,opened}
  );

  assert.deepEqual(await list(A),[]);
  assert.deepEqual(await list(B),[],"Browsers must not share IndexedDB");
  await save(A,fixture("concert-1","Original concert"),null);
  let result=await sync(A);
  assert.deepEqual(result.uploadedIds,["concert-1"]);
  assert.equal(server.size,1);
  assert.equal((await list(B)).length,0,"No cross-profile records before sync");
  result=await sync(B);
  assert.deepEqual(result.downloadedIds,["concert-1"]);
  assert.equal((await list(B))[0].title,"Original concert");
  assert.equal((await ledger(B)).length,1);

  // Concurrent edits in two browsers remain separate and never overwrite.
  const aBase=(await list(A))[0],bBase=(await list(B))[0];
  await save(A,{...aBase,title:"Device A edit"},aBase);
  await save(B,{...bBase,title:"Device B unsynced edit"},bBase);
  result=await sync(A);
  assert.deepEqual(result.uploadedIds,["concert-1"]);
  result=await sync(B);
  assert.equal(result.reviews[0]?.action,"conflict");
  assert.equal((await list(B))[0].title,"Device B unsynced edit");
  assert.equal(server.get("concert-1").record.title,"Device A edit");

  // A new record can still sync even when an unrelated record conflicts.
  await save(B,fixture("concert-2","Second device new concert"),null);
  result=await sync(B);
  assert.deepEqual(result.uploadedIds,["concert-2"]);
  assert.equal(result.reviews[0]?.action,"conflict");
  result=await sync(A);
  assert.ok(result.downloadedIds.includes("concert-2"));
  assert.equal((await list(A)).length,2);

  // User explicitly resolves by accepting the current remote version.
  const bConflicted=(await list(B)).find(x=>x.id==="concert-1");
  await save(B,server.get("concert-1").record,bConflicted);
  result=await sync(B);
  assert.equal(result.reviews.length,0);
  const bCurrent=(await list(B)).find(x=>x.id==="concert-1");
  await save(B,{...bCurrent,title:"Resolved on device B"},bCurrent);
  result=await sync(B);
  assert.deepEqual(result.uploadedIds,["concert-1"]);
  result=await sync(A);
  assert.deepEqual(result.downloadedIds,["concert-1"]);
  assert.equal((await list(A)).find(x=>x.id==="concert-1").title,
    "Resolved on device B");

  // CAS race: server changes only after our inventory read.
  const aCurrent=(await list(A)).find(x=>x.id==="concert-1");
  await save(A,{...aCurrent,title:"A pending edit"},aCurrent);
  raceNextCAS=true;
  result=await sync(A);
  assert.ok(result.deferredIds.includes("concert-1"));
  assert.equal((await list(A)).find(x=>x.id==="concert-1").title,
    "A pending edit");
  result=await sync(A);
  assert.equal(result.reviews[0]?.action,"conflict",
    "Recheck a CAS race instead of choosing a timestamp winner");

  // Offline edits retain their exact IndexedDB bytes and acknowledged ledger.
  const beforeOffline=copy(await ledger(B));
  await save(B,fixture("concert-offline","Offline saved concert"),null);
  offline=true;
  await assert.rejects(sync(B),/SYNTHETIC_OFFLINE/);
  assert.deepEqual(await ledger(B),beforeOffline);
  assert.ok((await list(B)).some(x=>x.id==="concert-offline"));
  offline=false;
  result=await sync(B);
  assert.ok(result.uploadedIds.includes("concert-offline"));
  result=await sync(A);
  assert.ok(result.downloadedIds.includes("concert-offline"),
    "Reconnected cross-device data must be visible to both profiles");

  // Actual production V3 conflict runtime against two independent browser
  // databases. Never use a real Supabase account or modify production data.
  // B has the prior acknowledged baseline, while A's CAS-raced remote has
  // diverged. Create another independent B edit to force a true conflict.
  const bBeforeResolve=(await list(B)).find(x=>x.id==="concert-1");
  await save(B,{...bBeforeResolve,title:"Device B protected local draft"},bBeforeResolve);
  result=await sync(B);
  assert.equal(result.reviews.find(x=>x.id==="concert-1")?.action,"conflict");
  let preview=await B.evaluate(()=>window.__v3Test.preview("concert-1"));
  assert.equal(preview.action,"conflict");
  assert.equal(preview.local.title,"Device B protected local draft");
  assert.equal(preview.cloud.title,"Remote concurrent winner");

  // The cloud is edited AFTER the preview, specifically during the selected
  // cloud CAS. This must fail without modifying the local business record.
  raceNextCAS=true;
  await assert.rejects(B.evaluate(p=>window.__v3Test.resolve(p,"keep-cloud"),preview));
  assert.equal((await list(B)).find(x=>x.id==="concert-1").title,
    "Device B protected local draft","CAS race must not overwrite local draft");
  assert.equal(server.get("concert-1").record.title,"Remote concurrent winner");
  const oldVault=await B.evaluate(()=>window.__v3Test.vault());
  assert.ok(oldVault.length>=1,"Losing version must be in durable local vault before CAS");
  const oldVaultRow=await B.evaluate(key=>window.__v3Test.vaultRow(key),oldVault[0].key);
  assert.equal(oldVaultRow.title,"Device B protected local draft");
  assert.deepEqual(oldVaultRow.bytes.length,1,"Preserve actual poster bytes, not a signed URL");

  // Explicitly accept a newly inspected cloud version; the server CAS
  // confirmation must happen before B's conditional local replacement.
  preview=await B.evaluate(()=>window.__v3Test.preview("concert-1"));
  const accepted=await B.evaluate(p=>window.__v3Test.resolve(p,"keep-cloud"),preview);
  assert.ok(accepted.protectedKey);
  assert.equal(accepted.deferred,false);
  assert.equal((await list(B)).find(x=>x.id==="concert-1").title,
    "Remote concurrent winner");
  assert.ok((await B.evaluate(()=>window.__v3Test.vault())).length>=2);
  assert.equal((await sync(B)).reviews.length,0);

  // A's independent pending version still exists; accepting the cloud on B
  // must not erase another device's unsynchronized edits.
  assert.equal((await list(A)).find(x=>x.id==="concert-1").title,"A pending edit");
  const aPreview=await A.evaluate(()=>window.__v3Test.preview("concert-1"));
  assert.equal(aPreview.action,"conflict");
  const aAccepted=await A.evaluate(p=>window.__v3Test.resolve(p,"keep-local"),aPreview);
  assert.equal(aAccepted.deferred,false);
  assert.equal(server.get("concert-1").record.title,"A pending edit");
  assert.equal((await sync(A)).reviews.length,0);
  result=await sync(B);
  assert.equal(result.downloadedIds.includes("concert-1"),true,
    "Other device should pull newly accepted cloud record after local-only choice");
  assert.equal((await list(B)).find(x=>x.id==="concert-1").title,"A pending edit");

  // Reloading one browser must preserve its IndexedDB + ledger, not reset sync.
  const beforeReload=await list(B);
  const ledgerBeforeReload=await ledger(B);
  await B.reload({waitUntil:"domcontentloaded"});
  await B.evaluate(async()=>{
    const {setStorageScope}=await import("/live-memory/src/storage.ts");
    setStorageScope("device-local");
    const {IndexedDbRecordRepository}=await import(
      "/live-memory/src/infrastructure/indexedDb/recordRepository.ts"
    );
    const {IndexedDbRevisionLedger}=await import(
      "/live-memory/src/infrastructure/indexedDb/revisionLedger.ts"
    );
    const {RemoteRevisionChanged}=await import(
      "/live-memory/src/core/ports/CloudRecordAdapter.ts"
    );
    const {synchronizeWithLedger}=await import(
      "/live-memory/src/core/application/synchronizeWithLedger.ts"
    );
    const local=new IndexedDbRecordRepository("device-local");
    const ledger=await IndexedDbRevisionLedger.create(
      "device-local","personal","isolated-v3-test-server"
    );
    const cloud={
      provider:"personal",accountScope:"device-local",
      identity:"isolated-v3-test-server",includeMedia:true,
      list:async()=>{const v=await window.__v3TestCloud({action:"list"});return v.records;},
      compareAndSwap:async(record,expected)=>{
        const v=await window.__v3TestCloud({action:"cas",record,expected});
        if(v.conflict)throw new RemoteRevisionChanged();
        return v.envelope;
      },
    };
    window.__v3Test={
      list:()=>local.list(),
      save:(row,old)=>local.saveIfUnchanged(row,old),
      sync:()=>synchronizeWithLedger(local,cloud,ledger),
      ledger:()=>ledger.snapshot().then(items=>[...items]),
    };
  });
  assert.deepEqual(await list(B),beforeReload,"Reload must not erase local records");
  assert.deepEqual(await ledger(B),ledgerBeforeReload,
    "Reload must preserve acknowledged remote revisions");
  assert.ok(casCalls>=5,"Test must actually exercise server-side optimistic writes");
  assert.deepEqual(outside,[],"No synthetic test may contact a real external API");
  console.log("V3 independent browser sync passed: 2 isolated IndexedDBs, real ledgers, CAS, conflict, offline, reconnect, reload. "+casCalls+" fake server writes.");
}finally{
  await Promise.all(contexts.map(ctx=>ctx.close().catch(()=>{})));
  await browser.close();
}
