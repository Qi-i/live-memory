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
  await page.locator(".archive-highlight-card-1 img").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(900);

  const bannerGeometry = await page.locator(".archive-highlight-card:visible").evaluateAll((cards) => cards.map((card) => {
    const rect = card.getBoundingClientRect();
    const image = card.querySelector("img");
    return {
      ratio: rect.height / rect.width,
      aspectRatio: getComputedStyle(card).aspectRatio,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
    };
  }));
  if (bannerGeometry.length < 3 || bannerGeometry.some(({ ratio, aspectRatio, objectFit }) => ratio < 1.2 || !aspectRatio.includes("2 / 3") || objectFit !== "contain")) {
    throw new Error(`Banner posters are not preserved as portrait images: ${JSON.stringify(bannerGeometry)}`);
  }

  const posterTops = await page.locator(".archive-poster-card").evaluateAll((cards) => cards.slice(0, 10).map((card) => Math.round(card.getBoundingClientRect().top)));
  const firstRowCount = posterTops.filter((top) => Math.abs(top - posterTops[0]) <= 3).length;
  if (firstRowCount < 5) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);
  await page.screenshot({ path: `${outputDir}/02-portrait-banner-desktop.png`, fullPage: true });

  await page.getByTitle("画报").click();
  await page.locator(".showcase-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outputDir}/03-showcase-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "制作分享图", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-preview-posters figure").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".share-export-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30000 });

  const shareMedia = await page.locator(".share-preview-posters figure").evaluateAll((figures) => figures.map((figure) => {
    const frame = figure.querySelector(".share-poster-frame");
    const image = figure.querySelector(".share-poster-foreground");
    const rect = frame?.getBoundingClientRect();
    return {
      frameRatio: rect ? rect.height / rect.width : 0,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
      naturalRatio: image && image.naturalWidth ? image.naturalHeight / image.naturalWidth : null,
    };
  }));
  if (!shareMedia.length || shareMedia.some(({ frameRatio, objectFit, naturalRatio }) => Math.abs(frameRatio - 1.5) > 0.08 || objectFit !== "contain" || (naturalRatio !== null && naturalRatio <= 1))) {
    throw new Error(`Share preview cropped or flattened portrait posters: ${JSON.stringify(shareMedia)}`);
  }
  await page.screenshot({ path: `${outputDir}/04-share-all-dense-mint.png`, fullPage: true });

  await page.getByRole("button", { name: "按时间", exact: true }).click();
  await page.locator(".share-range-control").waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: `${outputDir}/05-share-time-range.png`, fullPage: true });

  await page.getByRole("button", { name: "逐场选择", exact: true }).click();
  await page.locator(".share-selection-grid button").first().waitFor({ state: "visible", timeout: 10000 });
  const selectableCount = await page.locator(".share-selection-grid button").count();
  if (selectableCount < 4) throw new Error(`Manual selector only exposed ${selectableCount} records`);
  await page.locator(".share-selection-grid button").nth(1).click();
  await page.locator(".share-selection-grid button").nth(3).click();
  await page.screenshot({ path: `${outputDir}/06-share-manual-selection.png`, fullPage: true });

  await page.getByRole("button", { name: "全部记录", exact: true }).click();
  await page.getByRole("button", { name: "长图", exact: true }).click();
  await page.locator(".share-layout-control button").nth(1).click();
  await page.locator('.share-palette-control button[data-palette="paper"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outputDir}/07-share-long-catalog-paper.png`, fullPage: true });

  const exportButton = page.locator(".share-export-button");
  await page.waitForFunction(() => {
    const button = document.querySelector(".share-export-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    exportButton.click(),
  ]);
  await download.saveAs(`${outputDir}/08-exported-mass-share.png`);

  await page.getByRole("button", { name: "退出分享制作", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle("海报").click();
  await page.locator(".archive-highlight-card-1").waitFor({ state: "visible", timeout: 15000 });
  const mobileBannerBox = await page.locator(".archive-highlights").boundingBox();
  if (!mobileBannerBox || mobileBannerBox.height < 220) throw new Error("Mobile portrait banner is missing or collapsed");
  await page.screenshot({ path: `${outputDir}/09-portrait-banner-mobile.png`, fullPage: true });

  const mobileShareButton = page.locator(".archive-command-actions button").last();
  await mobileShareButton.scrollIntoViewIfNeeded();
  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "逐场选择", exact: true }).click();
  await page.locator(".share-selection-grid").waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: `${outputDir}/10-share-selector-mobile.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });

  await page.locator(".experience-mobile-nav").getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: `${outputDir}/11-example-settings-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
