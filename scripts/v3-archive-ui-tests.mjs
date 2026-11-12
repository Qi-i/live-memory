import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";

const chooser=await readFile(new URL("../src/ui/real/curateFeaturedRecords.ts",import.meta.url),"utf8");
const js=ts.transpileModule(chooser,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const env={exports:{}};
runInNewContext(js,env);
const choose=env.exports.curateFeaturedRecords;
assert.equal(typeof choose,"function");

const rows=[
  {id:"1",artists:["周深"],poster:true},
  {id:"2",artists:[" 周深 "],poster:true},
  {id:"3",artists:["凤凰传奇"],poster:true},
  {id:"4",artists:["房东的猫"],poster:false},
  {id:"5",artists:["李荣浩"],poster:true},
  {id:"6",artists:["汪苏泷","周深"],poster:true},
  {id:"7",artists:["毛不易"],poster:true},
  {id:"8",artists:["门尼"],poster:true},
  {id:"9",artists:["其他艺人"],poster:true},
];
assert.deepEqual(Array.from(choose(rows,r=>r.poster),r=>r.id),["1","3","5","7","8"],
  "Hero must use real poster sources and distinct artists, capped at five");
assert.deepEqual(Array.from(choose(rows,r=>r.poster,2),r=>r.id),["1","3"]);
assert.equal(choose(rows,r=>r.poster,0).length,0);
assert.equal(rows.length,9,"Curation is non-destructive");

const workspace=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const hero=await readFile(new URL("../src/ui/real/V3FeaturedHero.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../src/ui/real/realWorkspace.css",import.meta.url),"utf8");
const adaptive=await readFile(new URL("../src/ui/real/adaptivePoster.css",import.meta.url),"utf8");
const ratioSource=await readFile(new URL("../src/ui/real/posterFraming.ts",import.meta.url),"utf8");
const ratioJs=ts.transpileModule(ratioSource,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const framingEnv={exports:{}};
runInNewContext(ratioJs,framingEnv);
const {dominantPosterRatio,posterDisplayMode,visibleCropFraction}=framingEnv.exports;
assert.ok(Math.abs(dominantPosterRatio([.67,.66,.75,.65,.66])-.66)<.01,
  "Majority source shape must decide frame, not the tallest outlier");
assert.equal(posterDisplayMode(.64,.67),"cover");
assert.equal(posterDisplayMode(.42,.67),"backdrop");
assert.ok(visibleCropFraction(.64,.67)<.24);
assert.ok(visibleCropFraction(.42,.67)>.24);
assert.match(workspace,/type Page = "档案" \| "统计" \| "城市" \| "迁移"/);
assert.doesNotMatch(workspace,/page==="完整档案"/);
assert.match(workspace,/Object\.values\(posterRatios\)/);
assert.match(workspace,/active\.map\(record=><PosterCard/);
assert.doesNotMatch(workspace,/PAGE_SIZE|pageIndex|totalPages|上一页|下一页/);
assert.match(workspace,/showStatusCenter=\{false\}/);
assert.match(workspace,/canEditLegacyAccount/);
assert.match(workspace,/await requireAuthorizedWriter\(editing\.scope\)/);
assert.match(workspace,/<V3ArchiveCollections mode=/);
assert.doesNotMatch(workspace,/<ArchivePage records=/);
assert.match(workspace,/facets\.cities\.map/);
assert.match(workspace,/facets\.years\.map/);
assert.match(workspace,/favoritesOnly/);
assert.match(workspace,/sortMode===\"edited\"/);
for(const label of ["画报","票夹","票根","日历","城市/场馆","票价","汇总"]){
  assert.ok(workspace.includes('"' + label + '"'),"Missing historic archive view: "+label);
}
assert.match(workspace,/describeRealArchive\(records\)\.records, record=>Boolean\(primaryMedia\(record\)\),5/);
assert.match(hero,/posters\.slice\(0,5\)/);
assert.doesNotMatch(hero,/scrollBy|上一组海报|下一组海报/);
assert.match(css,/\.v3-real-featured-gallery\s*\{[^}]*grid-template-columns:repeat\(5/);
assert.match(adaptive,/\.v3-adaptive-poster\.is-extreme > img\.v3-adaptive-poster-image\s*\{[^}]*object-fit:contain/);
assert.match(adaptive,/\.v3-adaptive-poster > img\.v3-adaptive-poster-image\s*\{[^}]*object-fit:cover/);
assert.match(adaptive,/\.v3-adaptive-poster > img\.v3-adaptive-poster-backdrop/);
assert.doesNotMatch(workspace,/--v3-real-poster-ratio/);
console.log("V3 majority-ratio, bounded crop, continuous scroll, inline edit, archived layouts passed.");
