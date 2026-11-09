import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Run the production media cache module against a synthetic CacheStorage.
// Do not spin up a real browser or read any user's local media.
const source=(await readFile(new URL("../src/mediaCache.ts",import.meta.url),"utf8"))
  .replaceAll("import.meta.env.BASE_URL",JSON.stringify("/live-memory/"));
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const cacheByName=new Map();
let switchScopeDuringOpen=false;
globalThis.caches={
  async open(name){
    if(!cacheByName.has(name))cacheByName.set(name,new Map());
    if(switchScopeDuringOpen){
      switchScopeDuringOpen=false;
      cache.setMediaCacheScope("account-switched");
    }
    const storage=cacheByName.get(name);
    return {
      async match(request){return storage.get(request.url)?.clone()},
      async put(request,response){storage.set(request.url,response.clone());},
    };
  },
  async delete(name){return cacheByName.delete(name)},
  async keys(){return [...cacheByName.keys()]},
};
const cache={};
new Function("exports","require",js)(cache,name=>{
  if(name==="react")return {useEffect:()=>{},useState:()=>{}};
  throw Error("Unexpected production cache dependency: "+name);
});
cache.setMediaCacheScope("account-A");
const bytes=Buffer.from("SYNTHETIC PRIVATE TICKET BYTES, NEVER REAL USER DATA");
const checksum=createHash("sha256").update(bytes).digest("hex");
const recordHash="1".repeat(64),assetHash="2".repeat(64);
const record={id:"s1",recordId:"r1",kind:"ticket",mimeType:"image/png",
  storagePath:`opaque-owner/v3/${recordHash}/${assetHash}/${checksum}.png`,
  src:"https://signed.example.test/one-hour-token"};
const blob=new Blob([bytes],{type:"image/png"});
await cache.persistVerifiedOfflineMedia(record,blob);
assert.equal(await cache.hasVerifiedOfflineMedia(record),true,
  "A verified offline cache hit must avoid another signed URL download");
const saved=[...cacheByName.values()].flatMap(m=>[...m.values()]);
assert.equal(saved.length,1);
assert.ok(Buffer.from(await saved[0].arrayBuffer()).equals(bytes),
  "The CacheStorage entry must contain actual original ticket bytes");

const before=saved.length;
await assert.rejects(cache.persistVerifiedOfflineMedia({
  ...record,storagePath:record.storagePath.replace(checksum,"a".repeat(64)),
},blob),/V3_OFFLINE_MEDIA_SHA256_MISMATCH/);
await assert.rejects(cache.persistVerifiedOfflineMedia({
  ...record,storagePath:"unverifiable-owner/v3/without-hash.png",
},blob),/V3_OFFLINE_MEDIA_INVALID_PATH/);
await assert.rejects(cache.persistVerifiedOfflineMedia(record,new Blob(["<html>bad</html>"],{type:"text/html"})),
  /V3_OFFLINE_MEDIA_INVALID/);
assert.equal([...cacheByName.values()].flatMap(m=>[...m.values()]).length,before,
  "Corrupt or nonimage data must not enter CacheStorage");

cache.setMediaCacheScope("account-A");
assert.equal(await cache.hasVerifiedOfflineMedia({
  ...record, storagePath:record.storagePath.replace(checksum,"b".repeat(64)),
}),false,"Unverified content-addressed paths must not be accepted from the cache");
switchScopeDuringOpen=true;
await assert.rejects(cache.persistVerifiedOfflineMedia({
  ...record,storagePath:record.storagePath,
},blob),/V3_OFFLINE_ACCOUNT_CHANGED/);
assert.equal([...cacheByName.values()].flatMap(m=>[...m.values()]).length,1,
  "A midflight account switch must not commit the stale download to any cache");
assert.equal(await cache.hasVerifiedOfflineMedia(record),false,
  "A new account cannot read the old account's cached poster");
await cache.persistVerifiedOfflineMedia(record,blob);
assert.equal(await cache.hasVerifiedOfflineMedia(record),true);
assert.equal(cacheByName.size,2,
  "A new account has its own isolated offline cache, never the first account's files");
console.log("V3 offline bytes cache passed: original bytes, SHA-256, bad MIME/path, account-switch fence");
