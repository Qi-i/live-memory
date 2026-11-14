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
  const chrome=await page.evaluate(()=>{
    const toolbar=document.querySelector(".v3-global-toolbar");
    const actions=document.querySelector(".v3-real-topbar-actions");
    const bottom=document.querySelector(".v3-mobile-navigation");
    if(!toolbar||!actions||!bottom)throw Error("Missing V3 navigation or action group");
    const toolbarBox=toolbar.getBoundingClientRect();
    const actionBox=actions.getBoundingClientRect();
    const buttons=[...actions.querySelectorAll("button")].map(element=>{
      const box=element.getBoundingClientRect();
      return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,
        height:box.height,width:box.width};
    });
    return {
      bottomVisible:getComputedStyle(bottom).display!=="none",
      bottomButtons:bottom.querySelectorAll("button").length,
      falseStatus:bottom.querySelectorAll(".v3-mobile-status").length,
      actionOverflow:actionBox.left<toolbarBox.left-2||
        actionBox.right>toolbarBox.right+2||
        buttons.some(button=>button.left<toolbarBox.left-2||
          button.right>toolbarBox.right+2||button.height<32),
      overlap:buttons.some((a,i)=>buttons.slice(i+1).some(b=>
        Math.min(a.right,b.right)-Math.max(a.left,b.left)>3 &&
        Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>3)),
    };
  });
  if(chrome.falseStatus||chrome.actionOverflow||chrome.overlap)
    throw Error("V3 responsive action/nav inconsistency: "+JSON.stringify({width,chrome}));
  if(width<=800 && (!chrome.bottomVisible||chrome.bottomButtons!==3))
    throw Error("Real mobile navigation must expose exactly three core tabs: "+JSON.stringify(chrome));
  if(await page.getByRole("navigation",{name:"手机主导航"}).getByRole("button",{name:"迁移",exact:true}).count())
    throw Error("Migration is not a regular destination after V3 release");
  await page.getByLabel("更多档案视图").selectOption("画报");
  const columns=await page.locator(".v3-collection-showcase-grid").evaluate(element=>
    getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
  const expectedColumns=width>1180?5:width>610?3:2;
  if(columns!==expectedColumns)throw Error("V3 collection columns ignore content width: "+
    JSON.stringify({width,columns,expectedColumns}));
  await page.getByRole("button",{name:"海报",exact:true}).click();
  const posterGeometry=await page.locator(".v3-real-poster-card").first().evaluate(card=>{
    const media=card.querySelector(".v3-real-poster-image");
    const edit=card.querySelector(".v3-real-poster-edit");
    if(!media||!edit)throw Error("Poster is missing full-bleed image or contextual edit");
    const outer=card.getBoundingClientRect(),art=media.getBoundingClientRect(),pencil=edit.getBoundingClientRect();
    return {edgeX:Math.abs(outer.left-art.left),edgeY:Math.abs(outer.top-art.top),
      widthDelta:Math.abs(outer.width-art.width),padding:getComputedStyle(card).padding,
      editInside:pencil.left>=art.left&&pencil.right<=art.right&&pencil.bottom<=art.bottom,
      actionRow:card.querySelectorAll(".v3-real-card-actions").length,
      viewActions:card.querySelectorAll(".v3-real-poster-open").length,
      editActions:card.querySelectorAll(".v3-real-poster-edit").length};
  });
  if(posterGeometry.edgeX>2||posterGeometry.edgeY>2||posterGeometry.widthDelta>2||
    posterGeometry.padding!=="0px"||!posterGeometry.editInside||
    posterGeometry.actionRow!==0||posterGeometry.viewActions!==1||posterGeometry.editActions!==1)
    throw Error("Poster wall still wastes artwork width or duplicates actions: "+JSON.stringify({width,posterGeometry}));
  await page.screenshot({path:`${output}/archive-${width}.png`,fullPage:true});
  // Unified V3 facets are shared by every collection mode.
  const facetHeight=await page.getByLabel("按观演状态筛选").evaluate(node=>node.getBoundingClientRect().height);
  if(facetHeight<39)throw Error("V3 filter control remains too small: "+facetHeight);
  await page.getByLabel("按观演状态筛选").selectOption("watched");
  if(await page.locator(".v3-real-poster-card").count()!==1)
    throw Error("Watched status facet did not filter the same real records");
  await page.getByLabel("按观演状态筛选").selectOption("all");
  await page.getByLabel("按城市筛选").selectOption("北京");
  if(await page.locator(".v3-real-poster-card").count()!==1)
    throw Error("City facet did not filter archive");
  await page.getByRole("button",{name:"清除筛选"}).click();
  await page.getByRole("button",{name:"列表",exact:true}).click();
  await page.locator(".v3-real-index-row").filter({hasText:"北京现场 · 真实本机回归"}).waitFor();
  await page.getByRole("button",{name:"时间线",exact:true}).click();
  await page.getByText("郑州巡回演出 · 真实本机回归").first().waitFor();
  await page.getByRole("button",{name:"海报",exact:true}).click();
  const detailOpener=page.getByRole("button",{name:/查看 北京现场/});
  await detailOpener.click();
  const dialog=page.getByRole("dialog",{name:/北京现场.*档案详情/});
  await dialog.waitFor({state:"visible"});
  await dialog.getByText("合成测试备注").waitFor();
  await dialog.locator("footer button").last().focus();
  await page.keyboard.press("Tab");
  const stayedInDetail=await dialog.evaluate(node=>node.contains(document.activeElement));
  if(!stayedInDetail)throw Error("V3 detail Tab escaped the active modal");
  await page.keyboard.press("Escape");
  await dialog.waitFor({state:"detached"});
  const returnedFocus=await detailOpener.evaluate(node=>document.activeElement===node);
  if(!returnedFocus)throw Error("V3 detail Escape did not restore the opener focus");

  // The single real V3 archive replaces the redundant nested V2 archive.
  if(await page.getByRole("button",{name:"完整档案",exact:true}).count())
    throw Error("Redundant complete archive tab remains in V3");
  await page.locator(".v3-real-featured").waitFor({state:"visible"});
  if(await page.getByRole("button",{name:"上一组海报"}).count())
    throw Error("Featured hero must never require manual horizontal scrolling");
  await page.getByRole("button",{name:"制作分享图",exact:true}).click();
  const share=page.getByRole("dialog",{name:"分享工作室"});
  await share.waitFor({state:"visible"});
  await share.locator(".share-studio-summary strong").getByText("2",{exact:true}).waitFor();
  const shareGeometry=await share.evaluate(node=>{
    const stage=node.closest(".share-studio-stage");
    const panel=stage?.querySelector(".share-studio-panel");
    const preview=stage?.querySelector(".share-preview-area");
    if(!stage||!panel||!preview)throw Error("Missing V3 share surfaces");
    const rect=panel.getBoundingClientRect();
    const area=preview.getBoundingClientRect();
    const bg=getComputedStyle(panel).backgroundColor;
    const stageRect=stage.getBoundingClientRect();
    return {panelHeight:rect.height,previewHeight:area.height,
      panelTop:rect.top,previewTop:area.top,
      viewport:innerHeight,background:bg,stageWidth:stageRect.width,
      scrollHeight:stage.scrollHeight,clientHeight:stage.clientHeight};
  });
  if(shareGeometry.panelHeight<100||shareGeometry.previewHeight<140||
     shareGeometry.stageWidth>width+2||
     width<=800&&(
       shareGeometry.previewTop>=shareGeometry.panelTop||
       shareGeometry.previewHeight<shareGeometry.viewport*.45||
       shareGeometry.scrollHeight<=shareGeometry.clientHeight))
    throw Error("V3 share workspace hides preview or overflows: "+JSON.stringify({width,shareGeometry}));

  await share.locator(".share-v3-preset-actions").getByRole("button",{name:/纪念票根/}).click();
  await share.locator(".share-layout-canvas-tickets").waitFor({state:"visible"});
  await share.locator(".share-v3-preset-actions").getByRole("button",{name:/时间长卷/}).click();
  await share.locator(".share-timeline-band").first().waitFor({state:"visible"});
  await share.getByRole("button",{name:"退出分享制作"}).click();
  await share.waitFor({state:"detached"});
  // Device-only users can still restore their own portable backup without
  // receiving any authenticated ownerKey/Cloud migration operation.
  await page.locator(".v3-real-more-tools > summary").click();
  const menuHit=await page.getByRole("button",{name:"数据与备份",exact:true}).evaluate(button=>{
    const rect=button.getBoundingClientRect();
    const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    return top===button||button.contains(top);
  });
  if(!menuHit)throw Error("V3 featured hero intercepts the secondary data menu");
  await page.getByRole("button",{name:"数据与备份",exact:true}).click();
  await page.getByRole("heading",{name:"数据与备份"}).waitFor();
  if(await page.locator(".v3-migration-panel").count())
    throw Error("Legacy cloud diagnostics mounted before the explicit advanced toggle");
  const restoreSection=page.locator(".v3-real-restore");
  if(await restoreSection.count()){
    const restoreBorder=await restoreSection.evaluate(node=>getComputedStyle(node).borderStyle);
    if(restoreBorder==="none")throw Error("Backup restore entry lost the unified card boundary");
  }
  if(await page.locator(".v3-migration-panel").count())
    throw Error("Account migration panel must not appear in device-only mode");
  await page.getByRole("button",{name:"档案",exact:true}).first().click();
  await page.getByRole("button",{name:"统计",exact:true}).click();
  await page.getByRole("heading",{name:"观演统计"}).waitFor();
  const metricCard=page.locator(".v3-real-metrics article").first();
  const metricBorder=await metricCard.evaluate(node=>getComputedStyle(node).borderTopStyle);
  if(metricBorder!=="solid")throw Error("V3 metrics drifted from common card system");
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
  // 36+ real rows are visible in one scroll: no pagination or 18-item limit.
  if(width===1440){
    const rows=Array.from({length:35},(_,i)=>fixture(
      "bulk-"+i,"连续档案回归 "+i,"北京","watched",
      {artists:["测试艺人"+i],date:"2026-08-01"},
    ));
    await page.evaluate(async ({rows})=>{
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open("echo-archive-v2:device-local",1);
        request.onsuccess=()=>{
          const db=request.result,tx=db.transaction("records","readwrite");
          for(const row of rows)tx.objectStore("records").put(row);
          tx.oncomplete=()=>{db.close();resolve(true);};
          tx.onerror=()=>{db.close();reject(tx.error);};
        };
        request.onerror=()=>reject(request.error);
      });
    },{rows});
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator(".v3-real-poster-card").first().waitFor();
    const cards=await page.locator(".v3-real-poster-card").count();
    if(cards!==37)throw Error("All 37 records must be on one scrolling page: "+cards);
    if(await page.getByRole("button",{name:"下一页"}).count())
      throw Error("Pagination must not interrupt a long archive");
    for(const [name,selector] of [
      ["画报",".v3-collection-showcase"],
      ["票夹",".v3-collection-wallet-grid"],
      ["票根",".v3-collection-stubs"],
      ["日历",".v3-collection-calendar-grid"],
      ["城市/场馆",".v3-collection-places-grid"],
      ["票价",".v3-collection-cost-list"],
      ["汇总",".v3-collection-summary-grid"],
    ]){
      await page.getByLabel("更多档案视图").selectOption(name);
      await page.locator(selector).waitFor({state:"visible"});
      if(await page.locator(".v3-real-embedded-archive .archive-page").count())
        throw Error("V2 embedded archive leaked into native "+name);
    }
    await page.getByRole("button",{name:"海报",exact:true}).click();
    await page.locator(".v3-real-poster-grid .v3-real-poster-card").last().scrollIntoViewIfNeeded();
  }
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
    // The square imported sample is an extreme aspect ratio. Wait for the
    // intrinsic-image onLoad decision before inspecting its display policy.
    const extremeFrame=page.locator(".v3-real-poster-image.is-extreme").first();
    await extremeFrame.waitFor({state:"visible"});
    const realPoster=extremeFrame.locator("img.v3-adaptive-poster-image");
    await realPoster.waitFor({state:"visible"});
    const fit=await realPoster.evaluate(image=>{
      const frame=image.closest(".v3-real-poster-image");
      const rect=frame?.getBoundingClientRect();
      return {objectFit:getComputedStyle(image).objectFit,
        ratio:rect?rect.width/rect.height:0};
    });
    if(fit.objectFit!=="contain"||fit.ratio<.58||fit.ratio>.84)
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
    // Portable restore is reachable only through the secondary data utility.
    await page.locator(".v3-real-more-tools > summary").click();
    await page.getByRole("button",{name:"数据与备份",exact:true}).click();
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
