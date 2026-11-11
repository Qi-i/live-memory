import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/core/application/portableMediaBackup.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", compiled)(exports);

const blobs = {
  poster: new Blob(["synthetic poster bytes"], { type: "image/png" }),
  ticket: new Blob(["synthetic ticket bytes"], { type: "image/jpeg" }),
};
const record = {
  id: "show", title: "A synthetic live show", media: [
    { id: "poster", recordId: "show", src: "https://private.invalid/signed", storagePath: "old-owner/show/poster", kind: "poster" },
    { id: "ticket", recordId: "show", src: "blob:https://private.invalid/ticket", kind: "ticket" },
  ],
  mediaTombstones: [{ id: "old", deletedAt: "2026-10-01T00:00:00Z", storagePath:"old-owner/show/deleted" }],
};
const io = {
  assertScope() {},
  async load(asset) { return blobs[asset.id]; },
  async encode(blob) {
    const raw = Buffer.from(await blob.arrayBuffer()).toString("base64");
    return `data:${blob.type};base64,${raw}`;
  },
};
const original = structuredClone(record);
const backup = await exports.createPortableBackup([record], io);
assert.deepEqual(record, original, "Export must not mutate the V2 or V3 source record");
assert.equal(backup.mediaIncluded, true);
assert.equal(backup.portableMediaManifest.assets.length, 2);
assert.equal(backup.portableMediaManifest.totalBytes, blobs.poster.size + blobs.ticket.size);
assert.equal(backup.records[0].media[0].storagePath, undefined);
assert.equal(backup.records[0].media[1].storagePath, undefined);
assert.equal(backup.records[0].mediaTombstones[0].storagePath, undefined);
assert.ok(backup.records[0].media.every(item=>item.src.startsWith("data:image/")));
assert.ok(backup.portableMediaManifest.assets.every(item=>/^[a-f0-9]{64}$/.test(item.sha256)));
const valid = await exports.verifyPortableBackupDocument(backup);
assert.deepEqual(valid,{records:1,assets:2,totalBytes:blobs.poster.size+blobs.ticket.size});

const tamper = structuredClone(backup);
const token = tamper.records[0].media[0].src;
const rawBytes = Buffer.from((await (await fetch(token)).arrayBuffer()));
rawBytes[0] ^= 1;
tamper.records[0].media[0].src = "data:image/png;base64,"+rawBytes.toString("base64");
await assert.rejects(exports.verifyPortableBackupDocument(tamper),/HASH_MISMATCH/);
const missing = structuredClone(backup);
missing.records[0].media.pop();
await assert.rejects(exports.verifyPortableBackupDocument(missing),/COUNT_MISMATCH/);
const bogus = structuredClone(backup);
bogus.records[0].media[0].storagePath = "some-other-cloud/path";
await assert.rejects(exports.verifyPortableBackupDocument(bogus),/NOT_PORTABLE/);
await assert.rejects(exports.createPortableBackup(
  [record,record],io),/DUPLICATE_RECORD/);
await assert.rejects(exports.createPortableBackup(
  [record],{...io,async load(){return new Blob([])}}),/MEDIA_MISSING/);
let checks = 0;
await assert.rejects(exports.createPortableBackup(
  [record],{...io,assertScope(){checks++;if(checks === 3)throw Error("ACCOUNT_SWITCH")}}),
/ACCOUNT_SWITCH/);

const settings = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/ui/system/V3MigrationPanel.tsx", import.meta.url), "utf8");
assert.match(settings,/verifyPortableBackupDocument\(parsed\)/);
assert.match(panel,/createPortableBackup\(/);
assert.match(panel,/currentStorageScope\(\)/);
assert.match(panel,/downloadBlob\(/);
assert.doesNotMatch(panel,/\.upsert\(|\.compareAndSwap\(|\.synchronize\(/);
console.log("V3 portable backup passed: full media embedding, signed-URL removal, tombstone safety, SHA-256 import validation, failed file abort and account-switch fencing.");
