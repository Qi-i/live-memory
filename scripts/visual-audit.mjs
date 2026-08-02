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
const archiveView = async (title, selector) => {
  await page.getByTitle(title).click();
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 15000 });
};

function assertContained(name, child, parent, tolerance = 2) {
  if (!child || !parent
    || child.left < parent.left - tolerance
    || child.top < parent.top - tolerance
    || child.right > parent.right + tolerance
    || child.bottom > parent.bottom + tolerance) {
    throw new Error(`${name} is clipped or outside its container: ${JSON.stringify({ child, parent })}`);
  }
}

async function posterGeometry(selector) {
  return page.locator(selector).evaluateAll((figures) => figures.map((figure) => {
    const rect = figure.getBoundingClientRect();
    const image = figure.querySelector("img");
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
    };
  }));
}

async function assertSharePosters(label, canvasSelector) {
  const canvas = await page.locator(canvasSelector).boundingBox();
  const posters = await posterGeometry(`${canvasSelector} .share-layout-poster`);
  if (!canvas || posters.length < 3) throw new Error(`${label} did not render enough posters`);
  const parent = { left: canvas.x, top: canvas.y, right: canvas.x + canvas.width, bottom: canvas.y + canvas.height };
  posters.forEach((poster, index) => {
    if (poster.objectFit !== "contain" && poster.objectFit !== "fallback") {
      throw new Error(`${label} poster ${index + 1} is cropped with object-fit ${poster.objectFit}`);
    }
    assertContained(`${label} poster ${index + 1}`, poster, parent, 2);
  });
  for (let i = 0; i < posters.length; i += 1) {
    for (let j = i + 1; j < posters.length; j += 1) {
      const overlapW = Math.max(0, Math.min(posters[i].right, posters[j].right) - Math.max(posters[i].left, posters[j].left));
      const overlapH = Math.max(0, Math.min(posters[i].bottom, posters[j].bottom) - Math.max(posters[i].top, posters[j].top));
      const overlap = overlapW * overlapH;
      const smaller = Math.min(posters[i].width * posters[i].height, posters[j].width * posters[j].height);
      if (smaller > 0 && overlap / smaller > 0.015) {
        throw new Error(`${label} posters overlap: ${i + 1} and ${j + 1}`);
      }
    }
  }
  return { canvas, posters };
}

async function assertFixedPreviewFits(label) {
  const geometry = await page.locator(".share-preview-area.is-fixed").evaluate((area) => {
    const areaRect = area.getBoundingClientRect();
    const viewport = area.querySelector(".share-preview-viewport");
    const viewportRect = viewport?.getBoundingClientRect();
    const style = getComputedStyle(area);
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollWidth: area.scrollWidth,
      scrollHeight: area.scrollHeight,
      clientWidth: area.clientWidth,
      clientHeight: area.clientHeight,
      area: { left: areaRect.left, top: areaRect.top, right: areaRect.right, bottom: areaRect.bottom },
      viewport: viewportRect ? { left: viewportRect.left, top: viewportRect.top, right: viewportRect.right, bottom: viewportRect.bottom } : null,
    };
  });
  if (geometry.overflowX !== "hidden" || geometry.overflowY !== "hidden") {
    throw new Error(`${label} fixed preview is scrollable: ${JSON.stringify(geometry)}`);
  }
  assertContained(`${label} preview viewport`, geometry.viewport, geometry.area, 2);
}

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

  const bannerTitle = await page.locator(".archive-masthead h2").evaluate((heading) => ({
    rendered: getComputedStyle(heading, "::before").content,
    originalFontSize: getComputedStyle(heading).fontSize,
  }));
  if (!bannerTitle.rendered.includes("把现场，留在时间里") || bannerTitle.originalFontSize !== "0px") {
    throw new Error(`Premium banner title was not applied: ${JSON.stringify(bannerTitle)}`);
  }

  const masthead = await page.locator(".archive-masthead").boundingBox();
  const bannerCards = await posterGeometry(".archive-highlight-card:visible");
  if (!masthead || bannerCards.length < 3 || bannerCards.length > 4) {
    throw new Error(`Banner should show 3–4 representative posters, got ${bannerCards.length}`);
  }
  const mastheadBounds = { left: masthead.x, top: masthead.y, right: masthead.x + masthead.width, bottom: masthead.y + masthead.height };
  bannerCards.forEach((card, index) => {
    if (card.objectFit !== "contain") throw new Error(`Banner poster ${index + 1} is cropped with ${card.objectFit}`);
    assertContained(`Banner poster ${index + 1}`, card, mastheadBounds, 3);
  });
  await page.screenshot({ path: `${outputDir}/02-premium-banner-desktop.png`, fullPage: true });

  const archiveFrame = await page.locator(".archive-poster-media").first().evaluate((frame) => {
    const image = frame.querySelector("img");
    const rect = frame.getBoundingClientRect();
    return { ratio: rect.height / rect.width, objectFit: image ? getComputedStyle(image).objectFit : "fallback" };
  });
  if (Math.abs(archiveFrame.ratio - 1.25) > 0.08 || archiveFrame.objectFit !== "cover") {
    throw new Error(`Archive poster grid lost its compact 4:5 frame: ${JSON.stringify(archiveFrame)}`);
  }
  const posterTops = await page.locator(".archive-poster-card").evaluateAll((cards) => cards.slice(0, 10).map((card) => Math.round(card.getBoundingClientRect().top)));
  const firstRowCount = posterTops.filter((top) => Math.abs(top - posterTops[0]) <= 3).length;
  if (firstRowCount < 5) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);

  await archiveView("票夹", ".archive-wallet-card");
  await page.screenshot({ path: `${outputDir}/03-wallet-desktop.png`, fullPage: true });
  await archiveView("票根", ".archive-ticket");
  await page.screenshot({ path: `${outputDir}/04-ticket-desktop.png`, fullPage: true });
  await archiveView("列表", ".archive-list button");
  await page.screenshot({ path: `${outputDir}/05-list-desktop.png`, fullPage: true });
  await archiveView("海报", ".archive-poster-card");

  await page.getByRole("button", { name: "制作分享图", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".share-export-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30000 });

  await assertFixedPreviewFits("Wall");
  const wall = await assertSharePosters("Wall", ".share-layout-canvas-wall");
  const wallFill = wall.posters.reduce((sum, poster) => sum + poster.width * poster.height, 0) / (wall.canvas.width * wall.canvas.height);
  if (wallFill < 0.5) throw new Error(`Wall layout leaves too much empty space: ${wallFill.toFixed(3)}`);
  await page.screenshot({ path: `${outputDir}/06-share-wall-fit.png`, fullPage: true });

  const fitText = await page.locator(".share-preview-toolbar strong").textContent();
  await page.getByRole("button", { name: "放大预览", exact: true }).click();
  const zoomText = await page.locator(".share-preview-toolbar strong").textContent();
  if (fitText === zoomText) throw new Error("Preview zoom control did not change scale");
  await page.getByRole("button", { name: /适应窗口/ }).click();
  await assertFixedPreviewFits("Wall after fit reset");

  await layoutButton("时间长卷").click();
  await page.locator(".share-timeline-band").first().waitFor({ state: "visible", timeout: 10000 });
  await assertFixedPreviewFits("Timeline");
  await assertSharePosters("Timeline", ".share-layout-timeline .share-layout-canvas");
  await page.screenshot({ path: `${outputDir}/07-share-timeline.png`, fullPage: true });

  await layoutButton("编目杂志").click();
  await page.locator(".share-layout-canvas-magazine .share-layout-poster.is-hero").waitFor({ state: "visible", timeout: 10000 });
  const magazine = await assertSharePosters("Magazine", ".share-layout-canvas-magazine");
  const hero = magazine.posters[0];
  const regularAreas = magazine.posters.slice(1).map((poster) => poster.width * poster.height).sort((a, b) => a - b);
  const median = regularAreas[Math.floor(regularAreas.length / 2)] || 1;
  if (hero.width * hero.height <= median * 1.7) throw new Error("Magazine layout does not create clear poster hierarchy");
  const magazineFill = magazine.posters.reduce((sum, poster) => sum + poster.width * poster.height, 0) / (magazine.canvas.width * magazine.canvas.height);
  if (magazineFill < 0.48) throw new Error(`Magazine layout leaves too much empty space: ${magazineFill.toFixed(3)}`);
  await page.screenshot({ path: `${outputDir}/08-share-magazine-dense.png`, fullPage: true });

  await layoutButton("城市路线").click();
  await page.locator(".share-coordinate-field").waitFor({ state: "visible", timeout: 10000 });
  const coordinateCopy = await page.locator(".share-coordinate-field").innerText();
  if (!coordinateCopy.includes("非地图示意") || !coordinateCopy.includes("不绘制国界")) {
    throw new Error("City route is missing the required non-map compliance label");
  }
  if (await page.locator(".share-coordinate-field > i").count() < 1) throw new Error("City coordinate field has no city nodes");
  await assertFixedPreviewFits("City route");
  await page.screenshot({ path: `${outputDir}/09-share-city-coordinate-field.png`, fullPage: true });

  await page.getByRole("button", { name: "逐场选择", exact: true }).click();
  await page.locator(".share-selection-grid button").first().waitFor({ state: "visible", timeout: 10000 });
  const selectionDates = await page.locator(".share-selection-grid button small").evaluateAll((items) => items.slice(0, 5).map((item) => item.textContent?.slice(0, 10) || ""));
  const sortedDates = selectionDates.slice().sort((a, b) => b.localeCompare(a));
  if (selectionDates.join("|") !== sortedDates.join("|")) throw new Error(`Manual selection is not newest first: ${selectionDates.join(",")}`);

  await page.getByRole("button", { name: "全部记录", exact: true }).click();
  await page.locator(".share-format-control button").filter({ hasText: "手机长图" }).click();
  await layoutButton("时间长卷").click();
  await page.locator('.share-palette-control button[data-palette="paper"]').click();
  await page.waitForTimeout(500);
  const longOverflow = await page.locator(".share-preview-area.is-long").evaluate((area) => ({
    overflowX: getComputedStyle(area).overflowX,
    overflowY: getComputedStyle(area).overflowY,
    scrollWidth: area.scrollWidth,
    clientWidth: area.clientWidth,
  }));
  if (longOverflow.overflowX !== "hidden" || !["auto", "scroll"].includes(longOverflow.overflowY) || longOverflow.scrollWidth > longOverflow.clientWidth + 2) {
    throw new Error(`Long preview overflow is incorrect: ${JSON.stringify(longOverflow)}`);
  }
  await page.screenshot({ path: `${outputDir}/10-share-long-timeline.png`, fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.locator(".share-export-button").click(),
  ]);
  await download.saveAs(`${outputDir}/11-exported-share.png`);

  await page.getByRole("button", { name: "退出分享制作", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });

  await page.setViewportSize({ width: 1707, height: 960 });
  await archiveView("海报", ".archive-poster-card");
  await page.screenshot({ path: `${outputDir}/12-desktop-2k-150-equivalent.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".archive-highlight-card-1").waitFor({ state: "visible", timeout: 15000 });
  const mobileCards = await posterGeometry(".archive-highlight-card:visible");
  const mobileMasthead = await page.locator(".archive-masthead").boundingBox();
  if (!mobileMasthead || mobileCards.length < 3) throw new Error("Mobile banner posters are missing");
  const mobileBounds = { left: mobileMasthead.x, top: mobileMasthead.y, right: mobileMasthead.x + mobileMasthead.width, bottom: mobileMasthead.y + mobileMasthead.height };
  mobileCards.forEach((card, index) => assertContained(`Mobile banner poster ${index + 1}`, card, mobileBounds, 3));
  await page.screenshot({ path: `${outputDir}/13-banner-mobile.png`, fullPage: true });

  await archiveView("票夹", ".archive-wallet-card");
  const walletOffsets = await page.locator(".archive-wallet-card").evaluateAll((cards) => cards.slice(0, 4).map((card) => Math.round(card.getBoundingClientRect().top)));
  if (walletOffsets.length > 1 && walletOffsets[1] - walletOffsets[0] > 150) throw new Error("Mobile wallet cards are no longer layered");
  await page.screenshot({ path: `${outputDir}/14-wallet-mobile.png`, fullPage: true });

  await archiveView("票根", ".archive-ticket");
  const ticketTops = await page.locator(".archive-ticket").evaluateAll((cards) => cards.slice(0, 4).map((card) => Math.round(card.getBoundingClientRect().top)));
  if (ticketTops.length > 1 && Math.abs(ticketTops[1] - ticketTops[0]) > 3) throw new Error("Mobile ticket view is not a compact multi-column grid");
  await page.screenshot({ path: `${outputDir}/15-ticket-mobile.png`, fullPage: true });

  await archiveView("列表", ".archive-list button");
  await page.screenshot({ path: `${outputDir}/16-list-mobile.png`, fullPage: true });

  const mobileShareButton = page.locator(".archive-command-actions button").last();
  await mobileShareButton.scrollIntoViewIfNeeded();
  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });
  await assertFixedPreviewFits("Mobile share wall");
  await page.screenshot({ path: `${outputDir}/17-share-mobile-fit.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });
} finally {
  await browser.close();
}
