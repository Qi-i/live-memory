import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deploy=await readFile(new URL("../.github/workflows/deploy.yml",import.meta.url),"utf8");
const sw=await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
const preview=await readFile(new URL("../.github/workflows/v3-preview.yml",import.meta.url),"utf8");

// The published V2 route MUST remain the authoritative app while the V3
// standalone demo is attached as a verified, isolated artifact.
assert.match(deploy,/branches: \[main\]/);
assert.match(deploy,/workflow_run:/);
assert.match(deploy,/workflows: \["Build V3 standalone preview"\]/);
assert.match(deploy,/gh run download "\$source_run" --name v3-static-preview/);
assert.match(deploy,/info\.browserVerified !== true/);
assert.match(deploy,/info\.type !== "demo-only"/);
assert.match(deploy,/manifest\.sha !== process\.argv\[2\]/);
assert.match(deploy,/test -f "\$RUNNER_TEMP\/v3-preview\/index\.html"/);
assert.match(deploy,/mkdir -p dist\/v3-preview/);
assert.match(deploy,/Write deployment build info/);
assert.match(deploy,/Verify live deployment SHA/);
assert.match(deploy,/Verify independently published V3 demo/);
assert.match(deploy,/Update deployment-status branch/);

// Service Worker must not route any V3 preview subpaths through the V2
// navigation fallback or stale-while-revalidate cache.
assert.match(sw,/const previewPath = new URL\("v3-preview\/", self\.registration\.scope\)\.pathname/);
assert.match(sw,/if \(sameOrigin && url\.pathname\.startsWith\(previewPath\)\) return/);
assert.ok(sw.indexOf("if (sameOrigin && url.pathname.startsWith(previewPath)) return") <
  sw.indexOf('if (request.mode === "navigate")'),
  "Preview bypass must come BEFORE V2 navigation caching");
assert.match(preview,/browserVerified=true/);
assert.match(preview,/name: v3-static-preview/);

// Never pass V2 production credentials to the separately packaged demo.
assert.doesNotMatch(preview,/VITE_ACCOUNT_SUPABASE_URL|VITE_ACCOUNT_SUPABASE_ANON_KEY/);
console.log("V3 deployment compatibility passed: signed demo SHA, stable V2 live app and SW preview bypass.");
