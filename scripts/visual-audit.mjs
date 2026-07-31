import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_AUDIT_URL || "http://127.0.0.1:4173/";
const outputDir = "visual-artifacts";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (message) => { if (message.type() === "error") console.error(`[browser] ${message.text()}`); });
page.on("pageerror", (error) => console.error(`[pageerror] ${error.message}`));

try {
  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`Preview returned ${response?.status() || "no response"}`);

  await page.locator(".access-shell").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".access-poster-wall img").first().waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: `${outputDir}/01-login-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "进入示例", exact: true }).click();
  await page.locator(".experience-shell").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".archive-poster-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outputDir}/02-archive-poster-desktop.png`, fullPage: true });

  await page.getByTitle("画报").click();
  await page.locator(".showcase-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/03-archive-showcase-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "生成分享图", exact: true }).click();
  await page.locator(".share-canvas").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${outputDir}/04-share-landscape.png`, fullPage: true });
  await page.locator(".share-floating-controls").hover();
  await page.getByRole("button", { name: "退出分享", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle("海报").click();
  await page.locator(".archive-poster-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/05-archive-mobile.png`, fullPage: true });
  await page.locator(".experience-mobile-nav").getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: `${outputDir}/06-example-settings-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
