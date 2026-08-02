import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_AUDIT_URL || "http://127.0.0.1:4173/";
const outputDir = "visual-artifacts";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.error(`[browser] ${message.text()}`);
});
page.on("pageerror", (error) => console.error(`[pageerror] ${error.message}`));

const layoutButton = (label) => page.locator(".share-layout-control button").filter({ hasText: label }).first();

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
  await page.waitForTimeout(800);

  const bannerGeometry = await page.locator(".archive-highlight-card:visible").evaluateAll((cards) => cards.map((card) => {
    const rect = card.getBoundingClientRect();
    const image = card.querySelector("img");
    return {
      ratio: rect.height / rect.width,
      aspectRatio: getComputedStyle(card).aspectRatio,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
    };
  }));
  if (bannerGeometry.length < 3 || bannerGeometry.some(({ ratio, aspectRatio, objectFit }) => Math.abs(ratio - 1.25) > 0.12 || !aspectRatio.includes("4 / 5") || objectFit !== "cover")) {
    throw new Error(`Banner posters are not using filled 4:5 frames: ${JSON.stringify(bannerGeometry)}`);
  }

  const archiveFrame = await page.locator(".archive-poster-media").first().evaluate((frame) => {
    const image = frame.querySelector("img");
    const rect = frame.getBoundingClientRect();
    return { ratio: rect.height / rect.width, objectFit: image ? getComputedStyle(image).objectFit : "fallback" };
  });
  if (Math.abs(archiveFrame.ratio - 1.25) > 0.08 || archiveFrame.objectFit !== "cover") {
    throw new Error(`Archive poster frame is not filled 4:5: ${JSON.stringify(archiveFrame)}`);
  }

  const posterTops = await page.locator(".archive-poster-card").evaluateAll((cards) => cards.slice(0, 10).map((card) => Math.round(card.getBoundingClientRect().top)));
  const firstRowCount = posterTops.filter((top) => Math.abs(top - posterTops[0]) <= 3).length;
  if (firstRowCount < 5) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);
  await page.screenshot({ path: `${outputDir}/02-poster-frames-desktop.png`, fullPage: true });

  await page.getByTitle("画报").click();
  await page.locator(".showcase-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: `${outputDir}/03-showcase-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "制作分享图", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-preview-wall figure").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".share-export-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30000 });

  const shareMedia = await page.locator(".share-preview-wall figure").evaluateAll((figures) => figures.map((figure) => {
    const frame = figure.querySelector(".share-poster-frame");
    const image = figure.querySelector(".share-poster-foreground");
    const rect = frame?.getBoundingClientRect();
    return {
      frameRatio: rect ? rect.height / rect.width : 0,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
    };
  }));
  if (!shareMedia.length || shareMedia.some(({ frameRatio, objectFit }) => Math.abs(frameRatio - 1.25) > 0.1 || objectFit !== "cover")) {
    throw new Error(`Share preview does not use filled 4:5 poster frames: ${JSON.stringify(shareMedia)}`);
  }
  await page.screenshot({ path: `${outputDir}/04-share-wall-jade.png`, fullPage: true });

  const categoryButtons = page.locator(".share-category-control button");
  if (await categoryButtons.count() < 4) throw new Error("Share category shortcuts are missing");
  const festivalButton = page.locator(".share-category-control button").filter({ hasText: "音乐节" }).first();
  if (await festivalButton.isEnabled()) {
    await festivalButton.click();
    await page.waitForTimeout(250);
    if (!await festivalButton.evaluate((button) => button.classList.contains("is-active"))) {
      throw new Error("Category shortcut did not activate");
    }
    await festivalButton.click();
  }

  await page.locator(".share-sort-button").click();
  await page.locator(".share-sort-button").filter({ hasText: "最早在前" }).waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".share-sort-button").click();

  await layoutButton("时间长卷").click();
  await page.locator(".share-preview-timeline > section").first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: `${outputDir}/05-share-timeline.png`, fullPage: true });

  await layoutButton("编目杂志").click();
  await page.locator(".share-preview-magazine figure.is-hero").waitFor({ state: "visible", timeout: 10000 });
  const magazineHero = await page.locator(".share-preview-magazine figure.is-hero").boundingBox();
  const magazineRegular = await page.locator(".share-preview-magazine figure:not(.is-hero)").first().boundingBox();
  if (!magazineHero || !magazineRegular || magazineHero.width <= magazineRegular.width * 1.4) {
    throw new Error("Magazine layout does not create a real hero poster");
  }
  await page.screenshot({ path: `${outputDir}/06-share-magazine.png`, fullPage: true });

  await layoutButton("城市路线").click();
  await page.locator(".share-preview-cities > section").first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: `${outputDir}/07-share-city-route.png`, fullPage: true });

  await page.getByRole("button", { name: "逐场选择", exact: true }).click();
  await page.locator(".share-selection-grid button").first().waitFor({ state: "visible", timeout: 10000 });
  const selectionDates = await page.locator(".share-selection-grid button small").evaluateAll((items) => items.slice(0, 5).map((item) => item.textContent?.slice(0, 10) || ""));
  const sortedDates = selectionDates.slice().sort((a, b) => b.localeCompare(a));
  if (selectionDates.join("|") !== sortedDates.join("|")) {
    throw new Error(`Manual selection is not newest first: ${selectionDates.join(",")}`);
  }
  if (await page.locator(".share-selection-grid button").count() > 3) {
    await page.locator(".share-selection-grid button").nth(1).click();
    await page.locator(".share-selection-grid button").nth(3).click();
  }
  await page.screenshot({ path: `${outputDir}/08-share-manual-selection.png`, fullPage: true });

  await page.getByRole("button", { name: "全部记录", exact: true }).click();
  await page.locator(".share-format-control button").filter({ hasText: "手机长图" }).click();
  await layoutButton("时间长卷").click();
  await page.locator('.share-palette-control button[data-palette="paper"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/09-share-long-timeline-paper.png`, fullPage: true });

  const exportButton = page.locator(".share-export-button");
  await page.waitForFunction(() => {
    const button = document.querySelector(".share-export-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    exportButton.click(),
  ]);
  await download.saveAs(`${outputDir}/10-exported-share.png`);

  await page.getByRole("button", { name: "退出分享制作", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle("海报").click();
  await page.locator(".archive-highlight-card-1").waitFor({ state: "visible", timeout: 15000 });
  const mobileBannerBox = await page.locator(".archive-highlights").boundingBox();
  if (!mobileBannerBox || mobileBannerBox.height < 200) throw new Error("Mobile poster banner is missing or collapsed");
  await page.screenshot({ path: `${outputDir}/11-poster-banner-mobile.png`, fullPage: true });

  const mobileShareButton = page.locator(".archive-command-actions button").last();
  await mobileShareButton.scrollIntoViewIfNeeded();
  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "逐场选择", exact: true }).click();
  await page.locator(".share-selection-grid").waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: `${outputDir}/12-share-selector-mobile.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });

  await page.locator(".experience-mobile-nav").getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: `${outputDir}/13-example-settings-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
