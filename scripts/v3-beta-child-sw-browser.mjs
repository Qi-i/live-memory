import assert from "node:assert/strict";
import {chromium} from "playwright";
const base=(process.env.V3_BETA_TEST_URL||"http://127.0.0.1:4173/").replace(/\/?$/,"/");
const expected=new URL("beta-sw.js",base).href;
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({serviceWorkers:"allow"});
  await context.addInitScript(()=>{
    localStorage.setItem("live-memory-device-only-v1","1");
  });
  const page=await context.newPage();
  const failures=[];
  page.on("pageerror",err=>failures.push(err.message));
  const response=await page.goto(base,{waitUntil:"load"});
  assert.equal(response?.status(),200);
  await page.waitForFunction(async expectedUrl=>{
    const regs=await navigator.serviceWorker.getRegistrations();
    const reg=regs.find(r=>r.active?.scriptURL===expectedUrl);
    return Boolean(reg && reg.scope===new URL("./",expectedUrl).href);
  },expected,{timeout:20000});
  await page.waitForFunction(expectedUrl=>navigator.serviceWorker.controller?.scriptURL===expectedUrl,
    expected,{timeout:20000});
  await page.reload({waitUntil:"load"});
  await page.locator('[data-ui-system="v3"]').waitFor({state:"visible",timeout:15000});
  const result=await page.evaluate(async()=>{
    const registrations=await navigator.serviceWorker.getRegistrations();
    const cachesList=await caches.keys();
    return {scope:registrations[0]?.scope,controller:navigator.serviceWorker.controller?.scriptURL,
      cacheNames:cachesList};
  });
  assert.equal(result.controller,expected);
  assert.equal(result.scope,new URL("./",expected).href);
  assert.deepEqual(result.cacheNames,[],"The child worker must not cache private/media data");
  assert.deepEqual(failures,[]);
  await context.close();
}finally{await browser.close();}
console.log("V3 scoped passive service worker: beta controls only its own path, no caching, reload remained in real workspace.");
