import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const workspace=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const migration=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
const result=ts.transpileModule(workspace,{compilerOptions:{
  jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
},reportDiagnostics:true});
assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,
  "V3 real archive JSX must compile");

// One real archive owns its poster, timeline and index views. The old nested
// V2 ArchivePage no longer creates a second visually inconsistent archive.
assert.match(workspace,/type Page = "档案" \| "统计" \| "城市" \| "迁移"/);
assert.match(workspace,/navigation: Page\[\] = \["档案", "统计", "城市", "迁移"\]/);
assert.doesNotMatch(workspace,/page==="完整档案"|<ArchivePage|fullLayout/);
for(const pattern of [
  /<V3FeaturedHero posters=\{posters\}/,
  /curateFeaturedRecords\(/,
  /<PosterCard key=\{record.id\}/,
  /mode==="时间线"/,
  /mode==="海报"/,
  /<RecordIndexCard key=\{record.id\}/,
  /onDuplicate=\{canEdit\?requestDuplicate:undefined\}/,
  /onTrash=\{canEdit\?setDeleteCandidate:undefined\}/,
  /duplicateRecordForNextShow\(record\)/,
  /page==="迁移" && <>/,
  /access.mode==="account" && validScope &&/,
  /personalConnected=\{hasPersonalCloudConnection\(readSettings\(\)\)\}/,
  /writerMode\(\)!=="v3"/,
  /new IndexedDbRecordRepository\(actualScope\)/,
  /saveRecordDraft\(/,
  /<ImportDrawer/,
  /onSave=\{saveImportedRecord\}/,
  /saveImportedRecord=async\(record:EventRecord\)/,
  /V3_IMPORT_RECORD_ID_CONFLICT/,
  /批量导入/,
  /exportVerifiedLocalBackup\(/,
  /createPortableBackup\(original/,
  /verifyPortableBackupDocument\(archive\)/,
  /V3_BACKUP_LOCAL_CHANGED/,
  /导出可恢复本机备份/,
  /deleteCandidate[\s\S]*<ConfirmDialog/,
]) assert.match(workspace,pattern);

for(const pattern of [
  /stageAuthenticatedLegacyMedia\(settings,check\)/,
  /completeBackupInventory\(original, remoteBefore\)/,
  /verifyPortableBackupDocument\(backup\)/,
  /importSecureArchiveMirror\(parsed\)/,
]) assert.match(migration,pattern);
assert.doesNotMatch(workspace,/replaceAllRecords|\.permanentlyDeleteRecord\(|\.remove\(/,
  "A V3 view must never bypass atomic editing or delete source media");
console.log("V3 consolidated archive passed: one archive, curated posters, improved browse modes, and account-fenced atomic editing.");
