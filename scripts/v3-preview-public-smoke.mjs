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
    page.on("request", req => {
      const target = new URL(req.url());
      if (target.origin !== new URL(url).origin) unexpectedRequests.push(target.href);
    });
    const result = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!result || result.status() !== 200) throw Error("Standalone preview HTTP " + result?.status());
    await page.locator('[data-ui-system="v3"]').waitFor({ state: "visible", timeout: 15000 });
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
        art, hero: rect(".v3-stage-hero"), copy: rect(".v3-stage-hero-copy"),
        gallery: rect(".v3-stage-hero-gallery"), map: rect(".v3-map-stage"),
        side: rect(".v3-map-side"), tools: rect(".v3-action-toolbar"),
        buttons: [...document.querySelectorAll(".v3-action-toolbar button")].map(el => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
        bodyWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        artFit: getComputedStyle(document.querySelector(".v3-portrait-frame img")).objectFit,
      };
    });
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
