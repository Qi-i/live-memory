import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const src = await readFile(new URL("../src/core/application/auditBackupPortability.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(src, {compilerOptions:{
  module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022,
}}).outputText;
const exports = {};
new Function("exports", compiled)(exports);

const rows = [{media:[
  {id:"a",src:"data:image/png;base64,AA=="},
  {id:"b",src:"https://storage.example/signed?token=fake",storagePath:"user/poster.jpg"},
  {id:"c",src:"blob:https://example.invalid/temp"},
  {id:"d",src:"https://images.example/public.jpg"},
  {id:"e",src:""},
]}];
const result = exports.auditBackupPortability(rows);
assert.deepEqual(result, {
  records:1, assets:5, embeddedCandidates:1, storageReferences:1,
  transientBlobReferences:1, externalReferences:1, unavailableReferences:1,
  requiresSeparateMediaBackup:true,
});
assert.equal(exports.auditBackupPortability([{media:[]}]).requiresSeparateMediaBackup,false);
assert.equal(exports.auditBackupPortability([{media:[{src:"data:;base64,AAAA"}]}]).embeddedCandidates,1);
assert.equal(exports.auditBackupPortability([{media:[{src:"blob:foo",storagePath:"cloud/one"}]}]).storageReferences,1,
  "Storage must count as nonportable regardless of current signed or blob URL");

const ui = await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");
assert.match(settings, /<V3MigrationPanel settings=\{settings\} records=\{records\}/);
assert.match(ui, /auditBackupPortability\(records\)/);
assert.match(ui, /scopeGeneration\\.current !== requestGeneration/);
assert.match(ui, /currentStorageScope\\(\\) !== requestScope/);
assert.match(ui, /现有 JSON 不能被认定为完整媒体备份/);
assert.match(ui, /仍须验证导出文件可读及图片字节完整/);
assert.doesNotMatch(ui, /\.synchronize\(|\.compareAndSwap\(|replaceAllRecords\(/);
console.log("V3 backup audit passed: embedded media vs cloud references, ephemeral blobs, external URLs, no false portable-backup claim.");
