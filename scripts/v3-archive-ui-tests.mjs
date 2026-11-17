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
const collections=await readFile(new URL("../src/ui/real/V3ArchiveCollections.tsx",import.meta.url),"utf8");
assert.match(collections,/useCachedMediaSrc\(primaryMedia\(record, \["poster"\]\)\)/,
  "V3 collections must display an actual poster, never a private ticket or seat map");
assert.doesNotMatch(collections,/useCachedMediaSrc\(primaryMedia\(record\)\)/,
  "Ticket-first fallback must not be used for collection covers");
const hero=await readFile(new URL("../src/ui/real/V3FeaturedHero.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../src/ui/real/realWorkspace.css",import.meta.url),"utf8");
const shell=await readFile(new URL("../src/ui/system/WorkspaceShell.tsx",import.meta.url),"utf8");
const shellCss=await readFile(new URL("../src/ui/system/workspace.css",import.meta.url),"utf8");
const collectionCss=await readFile(new URL("../src/ui/real/v3Collections.css",import.meta.url),"utf8");
const refineCss=await readFile(new URL("../src/ui/real/v3ArchiveRefinements.css",import.meta.url),"utf8");
const migrationCss=await readFile(new URL("../src/ui/system/v3MigrationPanel.css",import.meta.url),"utf8");
const demoPreview=await readFile(new URL("../src/ui/system/V3Preview.tsx",import.meta.url),"utf8");
const shareUi=await readFile(new URL("../src/ui/real/v3ShareStudio.css",import.meta.url),"utf8");
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
assert.match(workspace,/type Page = "档案" \| "统计" \| "城市" \| "数据"/);
assert.match(workspace,/navigation: Array<Exclude<Page,"数据">> = \["档案", "统计", "城市"\]/);
assert.doesNotMatch(workspace,/navigation:.*"迁移"/,"Retired migration must not occupy a primary navigation slot");
assert.match(workspace,/className="v3-real-more-tools"/);
assert.match(workspace,/setPage\("数据"\)/);
assert.match(workspace,/showLegacyDiagnostics&&<>/,
  "Legacy cloud reconciliation diagnostics only mount on explicit advanced action");
assert.match(workspace,/className="v3-real-poster-meta"/);
assert.match(workspace,/className="v3-real-poster-edit"/);
assert.match(workspace,/<Pencil size=\{16\}/);
assert.doesNotMatch(workspace,/<div className="v3-real-card-actions">/,
  "Do not waste a full row on redundant edit/detail buttons");
assert.doesNotMatch(workspace,/aria-label=\{"更多详情 "\+record.title\}/);

assert.doesNotMatch(workspace,/page==="完整档案"/);
assert.match(workspace,/Object\.values\(posterRatios\)/);
assert.match(workspace,/active\.map\(record=><PosterCard/);
assert.doesNotMatch(workspace,/PAGE_SIZE|pageIndex|totalPages|上一页|下一页/);
assert.match(workspace,/showStatusCenter=\{false\}/);
assert.match(shell,/showStatusCenter && <div className="v3-mobile-status">/,
  "V3 real mode cannot show an idle/false mobile sync indicator");
assert.match(workspace,/<BrandMark size=\{36\}/);
assert.match(demoPreview,/<BrandMark size=\{36\}/);
assert.doesNotMatch(workspace,/>◈</);
assert.doesNotMatch(demoPreview,/>◈</);
assert.match(workspace,/className="v3-real-topbar-actions"/,
  "Real archive actions need a stable layout group across account modes");
assert.match(css,/\.v3-real-topbar-actions \{/);
assert.doesNotMatch(css,/nth-last-child/,
  "Account-dependent button order must not determine mobile geometry");
assert.match(css,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,104px\),1fr\)\)/);
assert.match(shellCss,/--v3-card-border:/);
assert.match(shellCss,/--v3-control-bg:/);
assert.match(shellCss,/\.v3-workspace-shell :is\(\.v3-real-panel,\.v3-collection,\.v3-migration-provider\)/);
assert.match(collectionCss,/container-type:inline-size/);
assert.match(collectionCss,/@container\(max-width:880px\)/);
assert.match(collectionCss,/@container\(max-width:570px\)/);
assert.match(migrationCss,/--v3-migration-accent:var\(--v3-accent/);
assert.doesNotMatch(migrationCss,/var\(--accent, #2563eb\)/,
  "V2 default blue must not replace the V3 design language");

assert.match(workspace,/useDialogBehavior<HTMLElement>\(/,
  "Real event detail must use shared modal Escape and focus trap");
assert.match(workspace,/ref=\{detailRef\} className="v3-real-modal/);
assert.doesNotMatch(workspace,/document\.addEventListener\("keydown",onKey\)/,
  "V3 event detail should not attach another uncoordinated Escape listener");
assert.match(workspace,/disabled=\{!primaryMedia\(record, \["poster"\]\)\}/,
  "Poster zoom cannot stay actionable without a real poster");
assert.match(workspace,/className="v3-real-detail-danger"/);
assert.match(css,/\.v3-real-modal footer button\.v3-real-detail-danger/);
assert.match(css,/\.v3-real-rich-detail \.v3-real-modal-art:disabled/);
assert.match(shareUi,/--share-ui-accent: var\(--v3-accent/);
assert.match(shareUi,/--share-ui-border: var\(--v3-card-border/);
assert.match(shareUi,/max-height:48dvh/);
assert.match(shareUi,/min-height:52dvh/);
assert.doesNotMatch(shareUi,/\.share-ticket-card\b/,
  "V3 overlay polish must not rewrite poster/ticket export artwork");
assert.match(refineCss,/\.v3-real-refine-bar label\{[^}]*font-size:12px/);
assert.match(refineCss,/\.v3-real-refine-bar select,\.v3-real-refine-bar button\{[^}]*min-height:40px/);
assert.match(refineCss,/\.v3-real-refine-bar button\.is-active\{[^}]*var\(--v3-accent-tint\)/);
assert.match(css,/\.v3-real-restore \{[^}]*var\(--v3-card-border\)/);
assert.match(css,/\.v3-real-restore-review button:first-of-type \{[^}]*var\(--v3-accent\)/);
assert.match(css,/\.v3-real-metrics article \{[^}]*var\(--v3-card-border\)/);
assert.match(refineCss,/\.v3-real-poster-card \{[^}]*padding:0;/);
assert.match(refineCss,/\.v3-real-poster-open \.v3-real-poster-image \{[^}]*border:0;/);
assert.match(refineCss,/\.v3-real-poster-edit \{[^}]*position:absolute;/);
assert.doesNotMatch(refineCss,/\.v3-real-card-actions/);
assert.match(css,/\.v3-real-more-tools/);
assert.match(workspace,/canEditLegacyAccount/);
assert.match(workspace,/await requireAuthorizedWriter\(editing\.scope\)/);
assert.match(workspace,/<V3ArchiveCollections mode=/);
assert.doesNotMatch(workspace,/<ArchivePage records=/);
assert.match(workspace,/facets\.cities\.map/);
assert.match(workspace,/facets\.years\.map/);
assert.match(workspace,/favoritesOnly/);
assert.match(workspace,/sortMode===\"edited\"/);
for(const label of ["画报","票夹","票根","日历","城市/场馆","票价","汇总"]){
  assert.ok(collections.includes('"' + label + '"'),"Missing native collection view: "+label);
}
assert.ok(workspace.includes('describeRealArchive(records).records, record=>Boolean(primaryMedia(record, ["poster"])),5'));
assert.match(hero,/posters\.slice\(0,5\)/);
assert.doesNotMatch(hero,/scrollBy|上一组海报|下一组海报/);
assert.match(css,/\.v3-real-featured-gallery\s*\{[^}]*grid-template-columns:repeat\(5/);
assert.match(adaptive,/\.v3-adaptive-poster\.is-extreme > img\.v3-adaptive-poster-image\s*\{[^}]*object-fit:contain/);
assert.match(adaptive,/\.v3-adaptive-poster > img\.v3-adaptive-poster-image\s*\{[^}]*object-fit:cover/);
assert.match(adaptive,/\.v3-adaptive-poster > img\.v3-adaptive-poster-backdrop/);
assert.doesNotMatch(workspace,/--v3-real-poster-ratio/);
const shareSource=await readFile(new URL("../src/shareStudio.tsx",import.meta.url),"utf8");
const routeSource=await readFile(new URL("../src/main.tsx",import.meta.url),"utf8");
assert.ok(workspace.includes('filter(y=>/^\\d{4}$/.test(y))'),
  "Year facets must match four-digit dates, not a literal backslash");
assert.match(workspace,/restoreTrashedRecord/);
assert.match(workspace,/trashedRecords\.map\(record/);
assert.match(workspace,/firstPosters\.length>0 && <V3FeaturedHero/);
assert.match(routeSource,/access\.mode === "guest"/, "Guest sample must not enter a private V3 scope");
assert.match(shareSource,/primaryMedia\(record, \["poster"\]\)/);
assert.doesNotMatch(shareSource,/primaryMedia\(record\)/,
  "A share must never substitute the private ticket for a missing poster");
assert.match(workspace,/function RealStatisticsSpotlight\(/,
  "Stats must expose a visual hero composed from real archive records");
assert.match(workspace,/primaryMedia\(record, \["poster"\]\)/,
  "Only actual poster media may be used as the statistics hero");
assert.match(workspace,/v3-real-city-insights/,
  "City page must show grounded city and record-count context");
assert.match(css,/\.v3-real-stat-spotlight\{/,
  "Stats poster hero requires responsive screenshot-ready styling");

console.log("V3 majority-ratio, bounded crop, continuous scroll, inline edit, archived layouts passed.");
