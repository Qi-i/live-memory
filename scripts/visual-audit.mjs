import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_AUDIT_URL || "http://127.0.0.1:4173/";
const outputDir = "visual-artifacts";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
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
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outputDir}/02-archive-poster-desktop.png`, fullPage: true });

  await page.getByTitle("画报").click();
  await page.locator(".showcase-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/03-archive-showcase-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "生成分享图", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-preview").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outputDir}/04-share-collage-dark.png`, fullPage: true });

  await page.locator(".share-layout-control button").nth(1).click();
  await page.locator('.share-palette-control button[data-palette="paper"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDir}/05-share-grid-paper.png`, fullPage: true });

  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "保存 PNG 图片", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(`${outputDir}/06-exported-share.png`);

  await page.getByRole("button", { name: "退出分享制作", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });
  await page.locator(".archive-page").waitFor({ state: "visible", timeout: 10000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle("海报").click();
  await page.locator(".archive-poster-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/07-archive-mobile.png`, fullPage: true });

  const mobileShareButton = page.locator(".archive-command-actions button").last();
  await mobileShareButton.scrollIntoViewIfNeeded();
  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: `${outputDir}/08-share-mobile.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });

  await page.locator(".experience-mobile-nav").getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: `${outputDir}/09-example-settings-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
