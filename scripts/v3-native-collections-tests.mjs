import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../src/ui/real/collectionMetrics.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const env={exports:{}};
runInNewContext(js,env);
const {groupByCity,groupByArtist,summarizeRecordedPrices,groupCalendarDays}=env.exports;
const records=[
  {id:"1",city:"北京",artists:["周深","周深"],price:0,date:"2026-09-27",title:"第一场"},
  {id:"2",city:"北京",artists:["周深","毛不易"],price:380,date:"2026-09-27",title:"第二场"},
  {id:"3",city:"天津",artists:["汪苏泷"],price:undefined,date:"2026-10-16",title:"第三场"},
  {id:"4",city:"天津",artists:[],price:929,date:"2026-10-18",title:"第四场"},
  {id:"5",city:"",artists:[],price:null,date:"2026-10-31",title:"第五场"},
];
assert.equal(groupByCity(records)[0][0],"北京");
assert.equal(groupByCity(records)[0][1].length,2);
assert.equal(groupByCity(records).length,3);
const artist=groupByArtist(records);
assert.equal(artist.find(([name])=>name==="周深")[1].length,2,
  "Same artist repeated in a single lineup counts only once");
assert.equal(artist.length,3);
const cost=summarizeRecordedPrices(records);
assert.equal(cost.total,1309);
assert.equal(cost.count,3,"Zero-priced concerts still have a recorded price");
assert.equal(cost.missing,2,"Never invent missing prices");
const september=groupCalendarDays(records,"2026-09");
assert.equal(september.get(27).length,2);
assert.equal(september.has(16),false);
assert.equal(groupCalendarDays(records,"bad-format").size,0);
assert.equal(records.length,5,"Read model cannot mutate source records");

const ui=await readFile(new URL("../src/ui/real/V3ArchiveCollections.tsx",import.meta.url),"utf8");
const workspace=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const share=await readFile(new URL("../src/shareStudio.tsx",import.meta.url),"utf8");
const migration=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
for(const mode of ["画报","票夹","票根","日历","城市/场馆","票价","汇总"]){
  assert.match(ui,new RegExp('mode==="'+mode.replace("/","\\/")+'"'));
}
for(const keyword of [".map(", "onOpen(record.id)", "onShare", "onEdit"])assert.ok(ui.includes(keyword));
assert.match(ui,/groupByCity\(records\)/);
assert.match(ui,/groupByArtist\(records\)/);
assert.match(ui,/summarizeRecordedPrices\(records\)/);
assert.match(ui,/groupCalendarDays\(records,selectedMonth\)/);
assert.doesNotMatch(workspace,/<ArchivePage|advancedLayouts|pageIndex|PAGE_SIZE/);
assert.match(workspace,/<V3ArchiveCollections mode=/);
assert.match(workspace,/filterStatus/);
assert.match(workspace,/filterCity/);
assert.match(workspace,/filterYear/);
assert.match(workspace,/favoritesOnly/);
assert.match(workspace,/sortMode/);
assert.match(workspace,/records=\{shareRecord\?\[shareRecord\]:\(page==="档案"\?active:records\)\}/);
assert.match(share,/\.filter\(record => !record.deletedAt\)/,
  "Trashed source records must never be exported in social story canvases");
assert.match(share,/useState<ItemLimit>\("all"\)/);
for(const name of ["selectV3TicketAlbum","selectV3LongTimeline","selectV3CityStory","selectV3EditorialPicks"]){
  assert.match(share,new RegExp(name));
}
assert.doesNotMatch(migration,/await inspect\("account"\)/);
assert.match(migration,/onClick=\{\(\)=>void stageLegacyMedia\(\)\}/);
assert.match(migration,/role="status"\s*aria-live="polite"/);
assert.match(migration,/已开始原图私有复制/);
console.log("V3 native views, city/artist/cost aggregation, share safety, one-account read-only auto-audit passed.");
