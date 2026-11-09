import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const content = await readFile(new URL("../src/core/application/describeRealArchive.ts",import.meta.url),"utf8");
const js = ts.transpileModule(content,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText;
const exports={};
new Function("exports",js)(exports);
const mk = (i, opts={})=>({
  id:"record-"+i, title:"Long personal concert title ".repeat(i%5+1),
  city:"City-"+String(i%20), venue:"Venue-"+i,
  date:"2026-"+String((i%12)+1).padStart(2,"0")+"-01",
  artists:["Artist "+(i%4)], tags:["Tag"+i],
  status:i%2===0?"watched":"planned",
  recordState:"normal", media:[{id:"media-"+i,kind:"poster",src:"data:image/png;base64,AA=="}],
  ...opts,
});
assert.deepEqual(exports.describeRealArchive([]), {
  records:[],watchedCount:0,cities:[],years:[],mediaCount:0,
});
const many=Array.from({length:200},(_,i)=>mk(i));
many[0].deletedAt="2026-11-08T00:00:00Z";
many[2].recordState="cancelled";
many[4].recordState="refunded";
const model=exports.describeRealArchive(many);
assert.equal(model.records.length,199);
assert.equal(model.mediaCount,199);
assert.equal(model.watchedCount,97);
assert.equal(model.cities.length,20);
assert.equal(model.years.length,1);
assert.equal(new Set(model.records.map(row=>row.id)).size,199);
assert.equal(model.records.some(row=>row.deletedAt),false);
assert.ok(model.records.every((row,i,items)=>i===0 || items[i-1].date>=row.date));
const filtered=exports.describeRealArchive(many,"ARTIST 3");
assert.equal(filtered.records.length,50);
assert.equal(exports.describeRealArchive(many,"unlikely-string").records.length,0);
const accented=exports.describeRealArchive([mk(900,{title:"深深的巡回演唱会"})],"巡回");
assert.equal(accented.records.length,1);
const special=exports.describeRealArchive([
  mk(300,{city:"",media:[],status:"planned"}),mk(301,{city:"北京",title:"A".repeat(800)}),
  mk(302,{city:"北京",status:"watched",recordState:"cancelled"}),
]);
assert.equal(special.cities.length,1);
assert.equal(special.cities[0].total,2);
assert.equal(special.mediaCount,2);
assert.equal(special.watchedCount,0);
assert.equal(many[0].deletedAt,"2026-11-08T00:00:00Z","Read model cannot mutate its input");

const component=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const main=await readFile(new URL("../src/main.tsx",import.meta.url),"utf8");
const styles=await readFile(new URL("../src/ui/real/realWorkspace.css",import.meta.url),"utf8");
assert.match(main,/VITE_V3_REAL_WORKSPACE === "1"/);
assert.match(main,/URLSearchParams\(window\.location\.search\)\.has\("v3-real-workspace"\)/);
assert.match(main,/<AccessGate><V3RealWorkspace \/><\/AccessGate>/);
assert.match(component,/currentStorageScope\(\)/);
assert.match(component,/listRecords\(\)\.then/);
assert.match(component,/snapshot\.scope===actualScope/);
assert.match(component,/useCachedMediaSrc\(asset\)/);
assert.match(component,/resolveMediaSource\(asset,true\)/);
assert.match(component,/MapSplitPane/);
assert.match(component,/StageHero/);
assert.match(component,/read-only|只读/);
assert.doesNotMatch(component,/saveRecord\(|\.upsert\(|\.compareAndSwap\(|replaceAllRecords\(|\.synchronize\(|\.remove\(|deleteRecord\(/,
  "Unverified real-data workspaces must never mutate V2 archive or cloud");
assert.doesNotMatch(component,/demoShows|demoPosters|demoData|mockCloud/);
assert.match(styles,/@media\(max-width:610px\)/);
console.log("V3 real archive read-model and isolated UI passed: 200 records, 20 cities, deletion and cancellation exclusions, search, real account scope and no writes.");
