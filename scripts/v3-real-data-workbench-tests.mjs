import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/infrastructure/createV3SyncRuntime.ts", import.meta.url), "utf8");

assert.match(settings, /!deviceOnly && <V3MigrationPanel settings=\{settings\}/,
  "Never mount migration controls in guest or device-only mode");
assert.match(ui, /await import\("\.\.\/\.\.\/infrastructure\/createV3SyncRuntime"\)/,
  "The real-data adapter must be imported only on user action, never in demo preview");
assert.match(ui, /await runtime\.audit\(\)/);
assert.match(ui, /await runtime\.bootstrapMatchingHistory\(\)/);
assert.match(ui, /onClick=\{\(\) => void inspect\(provider\)\}/);
assert.match(ui, /onClick=\{\(\) => void inspect\(provider, true\)\}/);
assert.match(ui, /state\.audit\.unresolved/);
assert.match(ui, /state\.bootstrap\.deferred/);
assert.doesNotMatch(ui, /\.synchronize\(|\.compareAndSwap\(|\.upsert\(|\.delete\(|replaceAllRecords|localStorage\.clear|\.upload\(/,
  "Migration diagnostics may not invoke V3 record writes or modify V2 archives");
assert.match(runtime, /async bootstrapMatchingHistory\(\)/);
assert.match(runtime, /if \(oneSided > 0 && !options\.initialTransferApproved\)/);
assert.doesNotMatch(ui, /console\.(log|info|debug)\s*\(/,
  "No record IDs, private data or connection settings may be logged");
console.log("V3 real-data workbench contract passed: click-only audited access, safe metadata baseline and no V2 write takeover.");
