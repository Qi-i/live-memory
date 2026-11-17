import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/core/application/concertReminderHandoff.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText;
const {createConcertReminderHandoff}=await import("data:text/javascript;base64,"+
  Buffer.from(js).toString("base64"));
const base={
  id:"show-001",title:"示例场次",date:"2027-02-03",time:"19:30",
  city:"北京",venue:"示例场馆",seat:"A区12排8号",
  status:"planned",recordState:"normal",
  updatedAt:"2026-11-18T00:00:00.000Z",
  deletedAt:undefined,
  media:[{src:"private://secret",kind:"ticket",data:"ticket-qr"}],
  price:950,sourceUrl:"https://ticket.test/?token=secret",
  note:"私人订单号",artists:["示例"],
};
const handoff=createConcertReminderHandoff([base],"2026-11-18T02:00:00.000Z");
assert.deepEqual(Object.keys(handoff).sort(),
  ["schemaVersion","sourceApp","purpose","generatedAt","records"].sort());
assert.equal(handoff.schemaVersion,1);
assert.equal(handoff.records[0].timeZone,"Asia/Shanghai");
assert.equal(handoff.records[0].seat,"A区12排8号");
assert.equal(handoff.records[0].deletedAt,null);
for(const secret of ["ticket-qr","private://","950","私人订单号","token=secret"]){
  assert.ok(!JSON.stringify(handoff).includes(secret),"No order/media/price: "+secret);
}
const removed=createConcertReminderHandoff([
  {...base,deletedAt:"2026-11-18T01:00:00.000Z",recordState:"cancelled"},
]);
assert.equal(removed.records[0].deletedAt,"2026-11-18T01:00:00.000Z");
assert.equal(removed.records[0].recordState,"cancelled");
assert.equal(createConcertReminderHandoff([{...base,city:"未知城市"}]).records[0].timeZone,"device-local");
assert.equal(createConcertReminderHandoff([{...base,time:"待定"}]).records[0].time,"");
assert.throws(()=>createConcertReminderHandoff([base,base]),/INVALID_RECORD/);
assert.throws(()=>createConcertReminderHandoff([{...base,updatedAt:""}]),/INVALID_RECORD/);
const ui=readFileSync(new URL("../src/ui/real/V3RealWorkspace.tsx",import.meta.url),"utf8");
assert.match(ui,/createConcertReminderHandoff/);
assert.match(ui,/concert-reminders/);
assert.match(ui,/currentStorageScope\(\)!==scope/);
console.log("QiHub concert reminders v1 export: fields, timestamps, tombstones, privacy and UI passed");
