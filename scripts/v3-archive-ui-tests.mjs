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
assert.doesNotMatch(workspace,/page==="完整档案"|<ArchivePage/);
assert.match(workspace,/describeRealArchive\(records\)\.records, record=>Boolean\(primaryMedia\(record\)\),5/);
assert.match(hero,/posters\.slice\(0,5\)/);
assert.doesNotMatch(hero,/scrollBy|scrollIntoView|上一组海报|下一组海报/);
assert.match(css,/\.v3-real-featured-gallery\s*\{[^}]*grid-template-columns:repeat\(5/);
assert.match(css,/\.v3-real-featured-image img\s*\{[^}]*object-fit:contain/);
assert.match(css,/\.v3-real-poster-image\s*\{[^}]*aspect-ratio:2\/3/);
assert.match(css,/\.v3-real-poster-image img\s*\{[^}]*object-fit:contain/);
assert.doesNotMatch(workspace,/--v3-real-poster-ratio|object-fit:cover/);
console.log("V3 featured curation, one archive navigation and uncropped poster geometry passed.");
