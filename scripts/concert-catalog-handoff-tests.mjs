import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/core/application/concertCatalogHandoff.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {readConcertCatalogRequest,createConcertCatalogReply}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const nonce="synthetic-32-byte-request-id";
const query="?qiledger_bridge=1&origin=https%3A%2F%2Fqiledger.pages.dev&request="+nonce;
assert.deepEqual(readConcertCatalogRequest(query),{target:"https://qiledger.pages.dev",request:nonce});
assert.equal(readConcertCatalogRequest(query.replace("qiledger.pages.dev","evil.example")),null);
assert.equal(readConcertCatalogRequest(query.replace(nonce,"short")),null);
const base={id:"record-test-id",title:"演唱会",category:"concert",date:"2027-01-01",city:"北京",venue:"场馆",price:399,note:"private",media:[{src:"secret"}]};
const reply=createConcertCatalogReply([base,{...base,id:"deleted",deletedAt:"2026-01-01"},{...base,id:"other",category:"festival"}],nonce);
assert.equal(reply.events.length,1);
assert.deepEqual(Object.keys(reply.events[0]).sort(),["id","title","date","city","venue","category","facePrice"].sort());
assert.equal(reply.events[0].facePrice,399);
assert.deepEqual(createConcertCatalogReply([],nonce).events,[]);
assert.ok(!JSON.stringify(reply).includes("secret")&&!JSON.stringify(reply).includes("private"));
for(const path of ["../src/AppRoot.tsx","../src/ui/real/V3RealWorkspace.tsx"]){
 const shell=readFileSync(new URL(path,import.meta.url),"utf8");
 assert.match(shell,/createConcertCatalogReply/);
 assert.match(shell,/window\.opener\.postMessage/);
}
console.log("Shared V2/V3 concert catalog: trusted destination, nonce, empty response and minimal projection passed");
