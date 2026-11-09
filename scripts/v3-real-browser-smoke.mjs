import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

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
    fixture("s2","郑州巡回演出 · 真实本机回归","郑州","planned",{coordinates:{lat:34.75,lng:113.62,provider:"wgs84"}}),
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
  await page.getByRole("cell",{name:"北京现场 · 真实本机回归"}).waitFor();
  await page.getByRole("button",{name:"时间线",exact:true}).click();
  await page.getByText("郑州巡回演出 · 真实本机回归").first().waitFor();
  await page.getByRole("button",{name:"海报",exact:true}).click();
  await page.getByRole("button",{name:/查看 北京现场/}).click();
  const dialog=page.getByRole("dialog",{name:/北京现场.*只读详情/});
  await dialog.waitFor({state:"visible"});
  await dialog.getByText("合成测试备注").waitFor();
  await dialog.getByRole("button",{name:"关闭只读详情"}).click();
  await dialog.waitFor({state:"detached"});
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
  if(initial!==after)throw Error("Read-only preview modified IndexedDB real archive");
  if(errors.length||external.length)throw Error("V3 real page errors/network: "+JSON.stringify({errors,external}));
  passed+=1;
  await context.close();
 }
}finally {await browser.close();}
console.log("V3 authenticated real workspace browser passed for "+passed+" viewports: real IndexedDB records, all views, no mutation, no cloud requests.");
