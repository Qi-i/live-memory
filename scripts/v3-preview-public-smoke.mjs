import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const url = process.env.V3_PREVIEW_URL || "http://127.0.0.1:4175/live-memory/v3-preview/";
const out = process.env.V3_AUDIT_OUTPUT || "visual-artifacts/v3-public";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failures = [];
try {
  for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [1024, 820], [1600, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    const unexpectedRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) errors.push(response.status() + " " + response.url()); });
    page.on("request", req => {
      const target = new URL(req.url());
      if (target.origin !== new URL(url).origin) unexpectedRequests.push(target.href);
    });
    const result = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!result || result.status() !== 200) throw Error("Standalone preview HTTP " + result?.status());
    try {
      await page.locator('[data-ui-system="v3"]').waitFor({ state: "visible", timeout: 10000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        href: location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 850),
        scripts: [...document.querySelectorAll("script[src]")].map(el => el.src),
        rootLength: document.querySelector("#root")?.innerHTML.length,
      }));
      throw Error("V3 demo root did not render: " + JSON.stringify({ diagnostic, errors, unexpectedRequests }));
    }
    await page.waitForFunction(() => [...document.querySelectorAll(".v3-stage-hero-gallery img")]
      .slice(0, 2).every(image => image.complete && image.naturalWidth > 0), null, { timeout: 20000 });

    const geom = await page.evaluate(() => {
      const rect = selector => {
        const node = document.querySelector(selector);
        if (!node) throw Error("Missing " + selector);
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const art = rect(".v3-portrait-frame");
      return {
        shell: rect(".v3-workspace-shell"), sidebar: rect(".v3-sidebar"),
        art, hero: rect(".v3-stage-hero"), copy: rect(".v3-stage-hero-copy"),
        gallery: rect(".v3-stage-hero-gallery"), map: rect(".v3-map-stage"),
        side: rect(".v3-map-side"), tools: rect(".v3-action-toolbar"),
        buttons: [...document.querySelectorAll(".v3-action-toolbar button")].map(el => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
        bodyWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        bodyHeight: document.documentElement.scrollHeight,
        artFit: getComputedStyle(document.querySelector(".v3-portrait-frame img")).objectFit,
      };
    });
    if (geom.shell.top < -1 || geom.shell.bottom > height + 1 || geom.shell.left < -1 || geom.shell.right > width + 1) {
      throw Error("Root workspace escapes viewport at " + width + ": " + JSON.stringify(geom.shell));
    }
    if (geom.bodyHeight > height + 2) throw Error("The browser document scrolls outside its app shell at " + width);
    if (width > 800 && geom.sidebar.bottom > height + 1) throw Error("Sidebar account area is clipped below the viewport");
    const initialMetrics = await page.locator(".v3-preview-topbar-stats b").allInnerTexts();
    if (!initialMetrics[0]?.trim().startsWith("7") || !initialMetrics[1]?.trim().startsWith("6") || !initialMetrics[2]?.trim().startsWith("5")) {
      throw Error("Header stats are inconsistent with demo fixtures: " + JSON.stringify(initialMetrics));
    }
    const aspect = geom.art.width / geom.art.height;
    if (aspect < 0.59 || aspect > 0.75 || geom.art.height < 150 || geom.artFit !== "contain")
      throw Error("Poster crushed or cropped: " + JSON.stringify({ width, art: geom.art, aspect, fit: geom.artFit }));
    if (geom.gallery.top < geom.copy.bottom - 2 && width <= 800)
      throw Error("Hero typography and portraits overlap at " + width);
    if (geom.bodyWidth > geom.viewportWidth + 3)
      throw Error("Global horizontal overflow at " + width);
    if (geom.buttons.some(b => b.left < geom.tools.left - 2 || b.right > geom.tools.right + 2))
      throw Error("Toolbar action clipped at " + width);
    if (width >= 1024 && Math.abs(geom.map.height - geom.side.height) > 2)
      throw Error("Map and city listing have different heights at " + width);
    await page.screenshot({ path: out + "/landing-" + width + ".png", fullPage: true });
    await page.getByRole("button", { name: "北京", exact: false }).last().click();
    await page.getByRole("dialog", { name: /北京的演出/ }).waitFor({ state: "visible" });
    const modalFit = await page.evaluate(() => {
      const map = document.querySelector(".v3-map-stage").getBoundingClientRect();
      const panel = document.querySelector(".v3-map-detail-layer").getBoundingClientRect();
      return panel.left >= map.left - 1 && panel.top >= map.top - 1
        && panel.right <= map.right + 1 && panel.bottom <= map.bottom + 1;
    });
    if (!modalFit) throw Error("City dialog escapes map panel at " + width);
    await page.screenshot({ path: out + "/city-" + width + ".png", fullPage: true });
    await page.getByRole("button", { name: "关闭城市详情" }).click();
    await page.getByRole("dialog", { name: /北京的演出/ }).waitFor({ state: "detached" });
    const before = await page.locator(".v3-stage-hero").evaluate(el => el.getBoundingClientRect().top);
    if (width > 800) {
      await page.getByRole("button", { name: "模拟冲突" }).click();
      await page.locator(".v3-sidebar").getByRole("button", { name: "查看同步状态" }).click();
      const message = await page.locator(".v3-sidebar .v3-status-current").innerText();
      if (!message.includes("真正的并发修改")) throw Error("No visible active conflict");
    } else {
      await page.getByRole("button", { name: "模拟冲突" }).click();
      await page.locator(".v3-mobile-status").getByRole("button", { name: "查看同步状态" }).click();
      const message = await page.locator(".v3-mobile-status .v3-status-current").innerText();
      if (!message.includes("真正的并发修改")) throw Error("Mobile status hidden");
    }
    const after = await page.locator(".v3-stage-hero").evaluate(el => el.getBoundingClientRect().top);
    if (Math.abs(after - before) > 1) throw Error("Status notification shifts content by " + (after - before));
    // A view selection must change the actual workspace, not only the pressed style.
    await page.getByRole("button", { name: "海报", exact: true }).click();
    const initialCards = await page.locator(".v3-demo-poster-grid > button").count();
    if (initialCards !== 7) throw Error("Poster wall not driven by the shared 7-record fixture: " + initialCards);
    await page.getByRole("button", { name: "新增记录", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新增演示记录" });
    await editor.waitFor({ state: "visible" });
    await editor.getByLabel("演出名称").fill("UI 回归验证演出");
    await editor.getByLabel("城市").fill("杭州");
    await editor.getByRole("button", { name: "保存演示记录" }).click();
    await editor.waitFor({ state: "detached" });
    const afterAdd = (await page.locator(".v3-preview-topbar-stats b").first().innerText()).trim();
    if (!afterAdd.startsWith("8")) throw Error("Saving a demo record did not update the shared statistics: " + afterAdd);

    await page.getByRole("button", { name: "列表", exact: true }).click();
    await page.getByRole("cell", { name: "UI 回归验证演出" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "统计", exact: true }).click();
    await page.getByRole("heading", { name: "现场履历" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: /Editorial/ }).click();
    const material = await page.locator(".v3-workspace-shell").getAttribute("data-v3-surface");
    if (material !== "editorial") throw Error("Theme setting did not reach the shared shell: " + material);
    await page.getByRole("button", { name: "档案", exact: true }).click();
    await page.getByRole("button", { name: "海报", exact: true }).click();
    await page.locator(".v3-demo-poster-grid > button").first().click();
    const detail = page.getByRole("dialog", { name: /详情/ });
    await detail.waitFor({ state: "visible" });
    await detail.getByRole("button", { name: "编辑演示记录" }).click();
    const editExisting = page.getByRole("dialog", { name: "编辑演示记录" });
    await editExisting.getByLabel("演出名称").fill("已编辑的临时演出");
    await editExisting.getByRole("button", { name: "保存演示记录" }).click();
    await editExisting.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "列表", exact: true }).click();
    await page.getByRole("cell", { name: "已编辑的临时演出" }).waitFor({ state: "visible" });
    if (errors.length) throw Error("Browser errors: " + errors.join(" | "));
    if (unexpectedRequests.length) throw Error("Standalone preview contacted an external service: " + unexpectedRequests.join(" | "));
    await context.close();
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("V3 public preview validated at 360/390/768/1024/1600px, no external requests, map/hero/status interactive.");
