import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const w=await readFile(new URL("../.github/workflows/v3-beta-publish.yml",import.meta.url),"utf8");
const verify=w.indexOf("      - name: Verify published V2 main and real-beta SHA independently");
const report=w.indexOf("      - name: Record independently verified beta SHA in release gate");
assert.ok(verify>=0 && report>verify,
  "The live SHA check must finish BEFORE any release-status update");
assert.match(w,/  verify:\n    permissions:\n      contents: read\n      issues: write\n/);
assert.match(w,/gh issue comment 54 --repo Qi-i\/live-memory --body-file/);
assert.match(w,/V3_SHA: \$\{\{ github\.sha \}\}/);
assert.match(w,/obj\.source!=="main"\|\|obj\.deployment!=="v2-unchanged"/);
assert.match(w,/b\.sha!==process\.env\.EXPECTED_SHA/);
assert.match(w,/b\.mainSha!==v\.sha/);
assert.match(w,/No user writer cutover|no user writer cutover/i);
assert.doesNotMatch(w,/git push.*main|git checkout .*main.*&&.*push/);
console.log("Live V3 beta proof gate: checks published beta + V2 main SHAs before reporting, no writer cutover.");
