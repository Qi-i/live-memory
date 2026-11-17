import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the fingerprint helpers extracted from the actual app controller.
// No network, app boot, fake media files or GitHub Actions.
const source=readFileSync(new URL("../src/appController.ts",import.meta.url),"utf8");
const start=source.indexOf("function recordFingerprint(");
const end=source.indexOf("function guestDemoRecords(",start);
assert.ok(start>=0 && end>start,"Missing the production sync fingerprint helpers");
const pure=source.slice(start,end);
const js=ts.transpileModule(pure,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const loaded={};
new Function("exports","hasPersonalCloudConnection","hasAccountCloudConfig",
  js+"\nexports.recordFingerprint=recordFingerprint;exports.mediaFingerprint=mediaFingerprint;"
)(loaded,()=>true,()=>true);

const settings={supabase:{url:"https://example.test",ownerKey:"private-key",
  syncMedia:true}};
const poster={id:"poster-a",src:"https://private.test/signed?token=one",
  storagePath:"private/stable-poster.webp",updatedAt:"2026-11-17T08:00:00Z"};
const first={id:"a",updatedAt:"2026-11-17T08:00:00Z",media:[poster]};
const second={id:"b",updatedAt:"2026-11-16T09:00:00Z",media:[]};
const rotated={...first,media:[{...poster,
  src:"https://private.test/signed?token=two",
}]};
const fingerprint=loaded.autoSyncFingerprint([first,second],settings);
assert.equal(fingerprint,loaded.autoSyncFingerprint([second,first],settings),
  "List sorting is not a record update");
assert.equal(fingerprint,loaded.autoSyncFingerprint([second,rotated],settings),
  "Renewed private signed URL is not a changed poster");
assert.equal(loaded.mediaFingerprint([first,second]),
  loaded.mediaFingerprint([rotated,second]),
  "The archive must not rerender just because a URL token was renewed");
assert.notEqual(fingerprint,loaded.autoSyncFingerprint([
  {...first,updatedAt:"2026-11-17T09:00:00Z"},second],settings),
  "An actual record revision remains observable");
assert.notEqual(fingerprint,loaded.autoSyncFingerprint([
  {...first,media:[{...poster,storagePath:"private/another-original.webp"}]},
  second],settings),"A changed original media identity must sync");
console.log("Live Memory sync fingerprint: order and signed URLs are no-ops; edits are detected");
