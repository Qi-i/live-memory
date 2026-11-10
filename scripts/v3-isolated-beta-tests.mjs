import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const [entry,config,workspace,preview]=await Promise.all([
  "src/main.tsx","vite.config.ts","src/ui/real/V3RealWorkspace.tsx",
  ".github/workflows/deploy.yml",
].map(path=>readFile(new URL("../"+path,import.meta.url),"utf8")));
assert.match(entry,/VITE_V3_BETA === "1"/);
assert.match(entry,/const v3RealWorkspace = v3Beta \|\|/);
assert.match(entry,/AccessGate><V3RealWorkspace/);
assert.match(entry,/import\.meta\.env\.PROD && !v3Beta/);
assert.doesNotMatch(entry,/V3_BETA[^;]*AppRoot\(/);
assert.match(workspace,/VITE_V3_BETA === "1"/);
assert.match(workspace,/https:\/\/qi-i\.github\.io\/live-memory\//);
assert.match(config,/isolatedRealBeta \? "\/" : "\/live-memory\/"/);
assert.match(config,/fileName: "v3-build-info\.json"/);
assert.match(config,/cloudWriterCutover: false/);
assert.match(preview,/branches: \[main\]/);
const [ci,betaCI]=await Promise.all([
  ".github/workflows/ci.yml",
  ".github/workflows/v3-real-beta.yml",
].map(path=>readFile(new URL("../"+path,import.meta.url),"utf8")));
for(const workflow of [ci,betaCI]) {
  assert.match(workflow,/VITE_V3_BETA=1 npx vite preview/,
    "Serving a beta build with the V2 base path causes a blank startup page");
}

console.log("Isolated V3 beta contracts passed: opt-in independent build, no V2 production writer, root path, origin-safe navigation, explicit unpromoted build SHA.");
