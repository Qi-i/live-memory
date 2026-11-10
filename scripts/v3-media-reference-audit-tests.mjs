import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source=await readFile(new URL("../src/core/application/auditMediaReferences.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
new Function("exports",compiled)(exports);
const audit=exports.auditMediaReferences;
const objects=[{bucket:"echo-media",path:"legacy/a.jpg"},{bucket:"v3-private",path:"owner/b.jpg"}];
const references=[{...objects[0],source:"device-1"},{bucket:"v3-private",path:"missing.jpg",source:"cloud"}];
const result=audit({objects,references,inventoryComplete:true,referencesComplete:true});
assert.deepEqual(result.referenced,[objects[0]]);
assert.deepEqual(result.unreferencedCandidates,[objects[1]]);
assert.deepEqual(result.missingObjects,[{bucket:"v3-private",path:"missing.jpg"}]);
for(const flags of [[false,true],[true,false],[false,false]]){
 const partial=audit({objects,references,inventoryComplete:flags[0],referencesComplete:flags[1]});
 assert.equal(partial.incomplete,true);
 assert.deepEqual(partial.unreferencedCandidates,[],"Never infer orphans from incomplete evidence");
 if(!flags[0])assert.deepEqual(partial.missingObjects,[]);
}
assert.deepEqual(audit({objects,references:[...references,{...references[0],source:"device-2"}],inventoryComplete:true,referencesComplete:true}).referenced,[objects[0]]);
assert.throws(()=>audit({objects:[objects[0],objects[0]],references:[],inventoryComplete:true,referencesComplete:true}),/DUPLICATE_OBJECT/);
assert.throws(()=>audit({objects:[{bucket:"x",path:"../secret"}],references:[],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);
assert.throws(()=>audit({objects,references:[{bucket:"x",path:"a",source:""}],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);
for (const flag of [undefined, null, 0, 1, "true"]) {
 assert.throws(() => audit({objects,references,inventoryComplete:flag,referencesComplete:true}),/INVALID_INPUT/);
 assert.throws(() => audit({objects,references,inventoryComplete:true,referencesComplete:flag}),/INVALID_INPUT/);
}
for (const path of ["folder\\\\secret.jpg", "folder/line\nfeed.jpg", "folder/zero\u0000byte.jpg"]) {
 assert.throws(() => audit({objects:[{bucket:"echo-media",path}],references:[],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);
}

for (const bucket of [" echo-media", "echo-media ", "echo/media", "echo\\\\media", "echo\nmedia"]) {
 assert.throws(() => audit({objects:[{bucket,path:"valid.jpg"}],references:[],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);
}
for (const path of ["a//b.jpg", "a/./b.jpg", "a/", "./a.jpg"]) {
 assert.throws(() => audit({objects:[{bucket:"echo-media",path}],references:[],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);
}
assert.throws(() => audit({objects,references:[{bucket:"echo-media",path:"valid.jpg",source:"device\nspoof"}],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);
for (const spoofed of ["safe\u202e.jpg", "safe\u2066.jpg"]) {\n assert.throws(() => audit({objects:[{bucket:"echo-media",path:spoofed}],references:[],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);\n assert.throws(() => audit({objects,references:[{bucket:"echo-media",path:"safe.jpg",source:spoofed}],inventoryComplete:true,referencesComplete:true}),/INVALID_INPUT/);\n}\nassert.doesNotMatch(source,/\.remove\(|\.delete\(|\.update\(|\.upload\(/,"Audit must remain read-only");
console.log("V3 read-only media audit tests passed");
