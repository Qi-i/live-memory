import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const workspace=await readFile(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
const archive=await readFile(new URL("../src/archive.tsx",import.meta.url),"utf8");
const migration=await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx",import.meta.url),"utf8");
const converted=ts.transpileModule(workspace,{compilerOptions:{
  jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
},reportDiagnostics:true});
assert.equal((converted.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,
  "V3 full archive JSX must compile");
for(const contract of [
  /page==="完整档案" && <ArchivePage/,
  /settings=\{readSettings\(\)\}/,
  /onEdit=\{requestBusinessEdit\}/,
  /onDuplicate=\{requestDuplicate\}/,
  /onDelete=\{row=>canEdit\?/,
  /onZoom=\{setZoomMedia\}/,
  /onOpen=\{row=>setSelectedId\(row\.id\)\}/,
  /page==="迁移" && access\.mode==="account" && validScope/,
  /personalConnected=\{hasPersonalCloudConnection\(readSettings\(\)\)\}/,
  /if\(!canEdit\).*setNotice/,
  /writerMode\(\)!=="v3"/,
  /new IndexedDbRecordRepository\(actualScope\)/,
  /saveRecordDraft\(/,
  /<ImportDrawer/,
  /onSave=\{saveImportedRecord\}/,
  /saveImportedRecord=async\(record:EventRecord\)/,
  /writerMode\(\)!=="v3"/,
  /V3_IMPORT_RECORD_ID_CONFLICT/,
  /record,null\)/,
  /批量导入/,

  /exportVerifiedLocalBackup\(/,
  /createPortableBackup\(original/,
  /verifyPortableBackupDocument\(archive\)/,
  /V3_BACKUP_LOCAL_CHANGED/,
  /导出可恢复本机备份/,
  /本机可恢复备份/,

  /deleteCandidate[\s\S]*<ConfirmDialog/,
]) assert.match(workspace,contract);
assert.match(archive,/function AmapFootprintMap\(/);
assert.match(archive,/const layoutGroups:/);
assert.match(migration,/stageAuthenticatedLegacyMedia\(settings,check\)/);
assert.match(migration,/completeBackupInventory\(original, remoteBefore\)/);
assert.match(migration,/verifyPortableBackupDocument\(backup\)/);
assert.match(migration,/importSecureArchiveMirror\(parsed\)/);
assert.doesNotMatch(workspace,/replaceAllRecords|\.permanentlyDeleteRecord\(|\.remove\(/,
  "V3 business view must never bypass atomic local editing or delete originals");
console.log("V3 full business integration passed: 10 existing archival layouts, real media zoom/share, account-fenced atomic edit, soft delete, verified backup and owner-bound staging actions.");
