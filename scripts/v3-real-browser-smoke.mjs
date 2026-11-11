import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const base=process.env.V3_REAL_AUDIT_URL||"http://127.0.0.1:4173/live-memory/?v3-real-workspace=1";
const output="visual-artifacts/v3-real";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const fixture=(id,title,city,status,extra={})=>({
 schemaVersion:2,id,title,city,venue:city+"测试场馆",
 date:"2026-09-27",status,recordState:"normal",category:"concert",
 artists:["测试艺人"],lineup:[],companions:[],tags:[],setlist:[],media:[],
 sourceChannel:"",favorite:false,colors:["#6671ab","#d2e2f2"],
 createdAt:"2026-09-27T00:00:00.000Z",updatedAt:"2026-09-27T00:00:00.000Z",
 ...extra,
});
let passed=0;
try {
 for(const [width,height] of [[390,844],[768,1024],[1024,820],[1440,900]]) {
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:"block"});
  await context.addInitScript(()=>{
    localStorage.setItem("live-memory-device-only-v1","1");
  });
  const page=await context.newPage();
  const errors=[];
  const external=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{
    const url=new URL(request.url());
    if(url.origin!==new URL(base).origin)external.push(request.url());
  });
  const response=await page.goto(base,{waitUntil:"domcontentloaded"});
  if(!response||response.status()!==200)throw Error("V3 real workspace endpoint failed: "+response?.status());
  await page.locator('[data-ui-system="v3"]').waitFor({state:"visible",timeout:15000});
  // Create ONLY disposable synthetic device rows. This test is never allowed
  // to read any real account, contact Supabase or invoke V2 automatic sync.
  await page.evaluate(async ({rows})=>{
    await new Promise((resolve,reject)=>{
      const req=indexedDB.open("echo-archive-v2:device-local",1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains("records")){
          const store=db.createObjectStore("records",{keyPath:"id"});
          for(const index of ["date","city","category","status"])store.createIndex(index,index);
        }
      };
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const db=req.result;
        const tx=db.transaction("records","readwrite");
        for(const row of rows)tx.objectStore("records").put(row);
        tx.oncomplete=()=>{db.close();resolve(true);};
        tx.onerror=()=>{db.close();reject(tx.error);};
      };
    });
  },{rows:[
    fixture("s1","北京现场 · 真实本机回归","北京","watched",{note:"合成测试备注",coordinates:{lat:39.90,lng:116.40,provider:"wgs84"}}),
    fixture("s2","郑州巡回演出 · 真实本机回归","郑州","planned",{date:"2099-09-27",coordinates:{lat:34.75,lng:113.62,provider:"wgs84"}}),
    fixture("s3","应该排除的软删除记录","北京","watched",{deletedAt:"2026-11-08T00:00:00.000Z"}),
  ]});
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByText("北京现场 · 真实本机回归",{exact:false}).first().waitFor({state:"visible"});
  const initial=await page.evaluate(async()=>{
    const db=await new Promise((res,rej)=>{
      const r=indexedDB.open("echo-archive-v2:device-local",1);
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
    });
    const list=await new Promise((res,rej)=>{
      const tx=db.transaction("records","readonly");
      const r=tx.objectStore("records").getAll();
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
    });
    db.close();
    return JSON.stringify(list);
  });
  const metrics=await page.locator(".v3-real-topbar-stats b").allInnerTexts();
  if(!metrics[0]?.trim().startsWith("2")||!metrics[1]?.trim().startsWith("1")||
     !metrics[2]?.trim().startsWith("2"))throw Error("Read model not using real 2-record data: "+JSON.stringify(metrics));
  if(await page.getByText("应该排除的软删除记录").count())
    throw Error("Deleted V2 archive record appeared in V3");
  const layout=await page.evaluate(()=>({
    shell:document.querySelector(".v3-workspace-shell")?.getBoundingClientRect().toJSON(),
    viewport:[innerWidth,innerHeight],
    docWidth:document.documentElement.scrollWidth,
    docHeight:document.documentElement.scrollHeight,
  }));
  if(layout.docWidth>width+2||layout.docHeight>height+2)throw Error("V3 real workspace escaped viewport: "+JSON.stringify(layout));
  await page.screenshot({path:`${output}/archive-${width}.png`,fullPage:true});
  await page.getByRole("button",{name:"列表",exact:true}).click();
  await page.locator(".v3-real-index-row").filter({hasText:"北京现场 · 真实本机回归"}).waitFor();
  await page.getByRole("button",{name:"时间线",exact:true}).click();
  await page.getByText("郑州巡回演出 · 真实本机回归").first().waitFor();
  await page.getByRole("button",{name:"海报",exact:true}).click();
  await page.getByRole("button",{name:/查看 北京现场/}).click();
  const dialog=page.getByRole("dialog",{name:/北京现场.*只读详情/});
  await dialog.waitFor({state:"visible"});
  await dialog.getByText("合成测试备注").waitFor();
  await dialog.getByRole("button",{name:"关闭只读详情"}).click();
  await dialog.waitFor({state:"detached"});
  // The single real V3 archive replaces the redundant nested V2 archive.
  if(await page.getByRole("button",{name:"完整档案",exact:true}).count())
    throw Error("Redundant complete archive tab remains in V3");
  await page.locator(".v3-real-featured").waitFor({state:"visible"});
  if(await page.getByRole("button",{name:"上一组海报"}).count())
    throw Error("Featured hero must never require manual horizontal scrolling");
  await page.getByRole("button",{name:"制作分享图",exact:true}).click();
  const share=page.getByRole("dialog",{name:"分享工作室"});
  await share.waitFor({state:"visible"});
  await share.getByRole("button",{name:"退出分享制作"}).click();
  await share.waitFor({state:"detached"});
  // Device-only users can still restore their own portable backup without
  // receiving any authenticated ownerKey/Cloud migration operation.
  await page.getByRole("button",{name:"迁移",exact:true}).first().click();
  await page.getByRole("heading",{name:"备份与迁移"}).waitFor();
  if(await page.locator(".v3-migration-panel").count())
    throw Error("Account migration panel must not appear in device-only mode");
  await page.getByRole("button",{name:"档案",exact:true}).first().click();
  await page.getByRole("button",{name:"统计",exact:true}).click();
  await page.getByRole("heading",{name:"观演统计"}).waitFor();
  await page.screenshot({path:`${output}/stats-${width}.png`,fullPage:true});
  await page.getByRole("button",{name:"城市",exact:true}).click();
  await page.getByRole("heading",{name:"城市与场馆"}).waitFor();
  await page.getByRole("img",{name:"2 条带坐标的演出分布"}).waitFor();
  await page.screenshot({path:`${output}/cities-${width}.png`,fullPage:true});
  const after=await page.evaluate(async()=>{
    const db=await new Promise((res,rej)=>{
      const r=indexedDB.open("echo-archive-v2:device-local",1);
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
    });
    const all=await new Promise((res,rej)=>{
      const tx=db.transaction("records","readonly");
      const req=tx.objectStore("records").getAll();
      req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
    });
    db.close();
    return JSON.stringify(all);
  });
  if(initial!==after)throw Error("Read-only browsing modified IndexedDB");
  // Only the explicitly device-local archive may write; verify a real
  // conditional transaction, then simulate an external-tab edit conflict.
  if(width===390){
    // Real UI path: locally import an original poster through the existing
    // multi-source import drawer. No cloud writer or legacy V2 timers run.
    await page.getByRole("button",{name:"批量导入",exact:true}).click();
    const importer=page.locator('.import-drawer-v2[role="dialog"]');
    await importer.waitFor({state:"visible"});
    // Browser-generated PNG guarantees real decodable original image bytes.
    const encoded=await page.evaluate(()=>{
      const canvas=document.createElement("canvas");
      canvas.width=4;canvas.height=4;
      const ctx=canvas.getContext("2d");
      if(!ctx)throw Error("Canvas API unavailable");
      ctx.fillStyle="#7f5a9c";ctx.fillRect(0,0,4,4);
      return canvas.toDataURL("image/png");
    });
    const pixel=Buffer.from(encoded.split(",")[1],"base64");
    await importer.locator('label:has-text("海报导入") input[type="file"]').setInputFiles({
      name:"v3-import-browser.png",mimeType:"image/png",buffer:pixel,
    });
    await page.getByRole("status").filter({hasText:"已导入 1 张海报档案"}).waitFor();
    await importer.getByRole("button",{name:"关闭批量导入"}).click();
    await importer.waitFor({state:"detached"});
    const imported=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open("echo-archive-v2:device-local",1);
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
      const rows=await new Promise((resolve,reject)=>{
        const request=db.transaction("records","readonly").objectStore("records").getAll();
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
      db.close();return rows;
    });
    const newPoster=imported.find(row=>row.title==="v3-import-browser");
    if(imported.length!==4 || !newPoster?.media?.[0]?.src?.startsWith("data:image/png;base64,")){
      throw Error("V3 batch import must persist a complete original poster without V2 writes");
    }
    // Real browser geometry test: even a square source is letterboxed in a
    // consistent portrait frame, never cropped or stretched.
    await page.getByRole("button",{name:"档案",exact:true}).first().click();
    const realPoster=page.locator(".v3-real-poster-image img").first();
    await realPoster.waitFor({state:"visible"});
    const fit=await realPoster.evaluate(image=>{
      const frame=image.closest(".v3-real-poster-image");
      const rect=frame?.getBoundingClientRect();
      return {objectFit:getComputedStyle(image).objectFit,
        ratio:rect?rect.width/rect.height:0};
    });
    if(fit.objectFit!=="contain"||Math.abs(fit.ratio-2/3)>.025)
      throw Error("V3 original poster cropped or card aspect ratio drifted: "+JSON.stringify(fit));
  }
  if(width===390){
    // Exercise actual user-file -> byte-verification -> single IndexedDB
    // transaction -> persisted data-URL readback, not just mock unit tests.
    const sourceBytes=Buffer.from("SYNTHETIC PORTABLE TICKET ORIGINAL");
    const assetSrc="data:image/png;base64,"+sourceBytes.toString("base64");
    const asset={id:"restore-poster",recordId:"verified-import-1",kind:"poster",
      src:assetSrc,source:"local",mimeType:"image/png",size:sourceBytes.length};
    const restoredRow={
      schemaVersion:2,id:"verified-import-1",title:"浏览器验证原图恢复",
      category:"concert",status:"watched",recordState:"normal",
      date:"2026-09-27",time:"",city:"北京",venue:"测试场馆",
      artists:["测试艺人"],lineup:[{name:"测试艺人",role:"artist"}],
      companions:[],tags:[],setlist:[],sourceChannel:"",favorite:false,
      colors:["#6671ab","#d2e2f2"],createdAt:"2026-09-27T00:00:00.000Z",
      updatedAt:"2026-09-27T00:00:00.000Z",media:[asset],mediaTombstones:[],
    };
    const document={
      app:"live-memory",version:3,mediaIncluded:true,
      exportedAt:"2026-11-10T00:00:00.000Z",records:[restoredRow],
      portableMediaManifest:{version:1,totalBytes:sourceBytes.length,
        assets:[{recordId:restoredRow.id,assetId:asset.id,
          bytes:sourceBytes.length,mimeType:"image/png",
          sha256:createHash("sha256").update(sourceBytes).digest("hex")}]},
    };
    await page.locator('input[aria-label="选择 V3 原图完整备份"]').setInputFiles({
      name:"verified-restore.json",mimeType:"application/json",
      buffer:Buffer.from(JSON.stringify(document)),
    });
    await page.getByRole("button",{name:"确认安全恢复到本机"}).waitFor({state:"visible"});
    await page.getByRole("button",{name:"确认安全恢复到本机"}).click();
    await page.getByRole("status").filter({hasText:"已在单个本机事务中安全新增 1 条"}).waitFor();
    const persistedMedia=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open("echo-archive-v2:device-local",1);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      const row=await new Promise((resolve,reject)=>{
        const req=db.transaction("records","readonly").objectStore("records").get("verified-import-1");
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      db.close();
      return row?.media?.[0]?.src||null;
    });
    if(persistedMedia!==assetSrc)throw Error("Portable restore did not persist exact original media bytes");
    await page.getByRole("button",{name:"新增本机演出"}).click();
    const createdDialog=page.getByRole("dialog",{name:"新增演出"});
    await createdDialog.waitFor({state:"visible"});
    await createdDialog.locator("input[required]").first().fill("本机安全新增 · V3");
    await createdDialog.getByRole("button",{name:/保存记录/}).click();
    await createdDialog.waitFor({state:"detached"});
    await page.getByRole("status").filter({hasText:"已安全保存至此设备"}).waitFor();
    const persisted=await page.evaluate(async()=>{
      const db=await new Promise((res,rej)=>{
        const request=indexedDB.open("echo-archive-v2:device-local",1);
        request.onsuccess=()=>res(request.result);request.onerror=()=>rej(request.error);
      });
      const rows=await new Promise((res,rej)=>{
        const request=db.transaction("records","readonly").objectStore("records").getAll();
        request.onsuccess=()=>res(request.result);request.onerror=()=>rej(request.error);
      });
      db.close();
      return rows;
    });
    if(persisted.length!==6||!persisted.some(row=>row.title==="本机安全新增 · V3")) {
      throw Error("Device V3 atomic create did not persist one new record");
    }

    await page.getByRole("button",{name:"档案",exact:true}).click();
    await page.getByRole("button",{name:/查看 北京现场/}).click();
    await page.getByRole("button",{name:"编辑本机演出"}).click();
    const editDialog=page.getByRole("dialog",{name:"编辑演出"});
    await editDialog.waitFor({state:"visible"});
    await editDialog.locator("input[required]").first().fill("绝不能覆盖其他标签页");
    await page.evaluate(async()=>{
      const db=await new Promise((res,rej)=>{
        const request=indexedDB.open("echo-archive-v2:device-local",1);
        request.onsuccess=()=>res(request.result);request.onerror=()=>rej(request.error);
      });
      await new Promise((resolve,reject)=>{
        const tx=db.transaction("records","readwrite");
        const store=tx.objectStore("records");
        const get=store.get("s1");
        get.onsuccess=()=>store.put({...get.result,title:"另一个标签页已保存",updatedAt:new Date().toISOString()});
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });
      db.close();
    });
    await editDialog.getByRole("button",{name:/保存记录/}).click();
    await editDialog.getByRole("alert").getByText(/另一标签页已修改/).waitFor();
    if(!await editDialog.isVisible()) throw Error("Conflicted draft was discarded");
    const winner=await page.evaluate(async()=>{
      const db=await new Promise((res,rej)=>{
        const req=indexedDB.open("echo-archive-v2:device-local",1);
        req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
      });
      const row=await new Promise((res,rej)=>{
        const req=db.transaction("records","readonly").objectStore("records").get("s1");
        req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
      });
      db.close();return row?.title;
    });
    if(winner!=="另一个标签页已保存")throw Error("V3 editor overwrote a concurrent-tab edit");
  }
  if(errors.length||external.length)throw Error("V3 real page errors/network: "+JSON.stringify({errors,external}));
  passed+=1;
  await context.close();
 }
}finally {await browser.close();}
console.log("V3 authenticated real workspace browser passed for "+passed+" viewports: real IndexedDB records, all views, read-only views, atomic local edit, stale-tab safety and no cloud requests.");
