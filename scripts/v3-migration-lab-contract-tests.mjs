import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const paths={
  vite:"../vite.config.ts",
  main:"../src/main.tsx",
  lab:"../src/ui/system/V3MigrationLab.tsx",
  panel:"../src/ui/system/V3MigrationPanel.tsx",
  sw:"../public/sw.js",
};
const docs={};
for(const [name,path] of Object.entries(paths)){
  docs[name]=await readFile(new URL(path,import.meta.url),"utf8");
}
assert.match(docs.vite,/env\.VITE_V3_MIGRATION_LAB === "1"/);
assert.match(docs.vite,/migrationLab \? "\/live-memory\/v3-migration\/"/);
assert.match(docs.main,/const migrationLab = import\.meta\.env\.VITE_V3_MIGRATION_LAB === "1"/);
const route=docs.main.slice(docs.main.indexOf("if (migrationLab) {"),
  docs.main.indexOf("} else if (v3Preview)"));
assert.match(route,/import\("\.\/ui\/system\/V3MigrationLab"\)/);
assert.match(route,/<AccessGate><V3MigrationLab \/><\/AccessGate>/);
assert.doesNotMatch(route,/<App\s*\/>|V3Preview|V3RealWorkspace/,
  "Migration-only artifact must never render V2 AppRoot or other routes");
assert.match(docs.main,/import\.meta\.env\.PROD && !migrationLab/);
assert.match(docs.lab,/access\.mode!=="account"/);
assert.match(docs.lab,/scope!==access\.user\.id\.toLowerCase\(\)/);
assert.match(docs.lab,/valid && snapshot &&/);
assert.match(docs.lab,/hasPersonalCloudConnection\(snapshot\.settings\)/);
assert.match(docs.lab,/<V3MigrationPanel/);
assert.doesNotMatch(docs.lab,/\.synchronize\(|\.compareAndSwap\(|\.upsert\(|\.remove\(|\.activate_/);
assert.match(docs.panel,/onClick=\{\(\)=>void stageLegacyMedia\(\)\}/);
assert.match(docs.sw,/const migrationPath = new URL\("v3-migration\/", self\.registration\.scope\)\.pathname/);
assert.match(docs.sw,/if \(sameOrigin && url\.pathname\.startsWith\(migrationPath\)\) return/);
assert.ok(docs.sw.indexOf("url.pathname.startsWith(migrationPath)") <
  docs.sw.indexOf('if (request.mode === "navigate")'),
  "Production V2 worker may not intercept new migration lab pages");
console.log("V3 authenticated migration lab isolation passed: no V2 writer, account gate, explicit staging and SW exclusion.");
