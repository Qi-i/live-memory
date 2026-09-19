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
  serviceWorkers: "block",
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
    if (poster.objectFit !== "cover" && poster.objectFit !== "fallback") {
      throw new Error(`${label} poster ${index + 1} does not fill its frame with object-fit ${poster.objectFit}`);
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
  await page.waitForFunction(() => {
    const area = document.querySelector(".share-preview-area.is-fixed");
    const viewport = area?.querySelector(".share-preview-viewport");
    if (!(area instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return false;
    const areaRect = area.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    return viewportRect.left >= areaRect.left - 2
      && viewportRect.top >= areaRect.top - 2
      && viewportRect.right <= areaRect.right + 2
      && viewportRect.bottom <= areaRect.bottom + 2;
  }, null, { timeout: 5000 });
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

  // A normal refresh must hydrate posters from the persistent media cache instead
  // of refetching every image. Block demo-media network requests after the first
  // load so this fails if Cache Storage/session scope restoration regresses.
  await page.waitForFunction(async () => {
    if (!("caches" in window)) return false;
    const names = (await caches.keys()).filter((name) => name.startsWith("live-memory-media-v3"));
    let entries = 0;
    for (const name of names) entries += (await (await caches.open(name)).keys()).length;
    return entries >= 5;
  }, null, { timeout: 15000 });

  const blockedDemoRequests = [];
  await page.route("**/demo/**", (route) => {
    blockedDemoRequests.push(route.request().url());
    void route.abort("failed");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".experience-shell").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".archive-poster-card img").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".archive-highlight-card-1 img").waitFor({ state: "visible", timeout: 15000 });
  const reloadFallbacks = await page.locator(".archive-poster-card .record-media-fallback").count();
  if (blockedDemoRequests.length || reloadFallbacks) {
    throw new Error(`Persistent media cache did not survive reload: ${JSON.stringify({ blockedDemoRequests, reloadFallbacks })}`);
  }
  await page.unroute("**/demo/**");

  const bannerTitle = await page.locator(".archive-masthead h2").evaluate((heading) => ({
    rendered: getComputedStyle(heading, "::before").content,
    originalFontSize: getComputedStyle(heading).fontSize,
  }));
  if (!bannerTitle.rendered.includes("把现场，留在时间里") || bannerTitle.originalFontSize !== "0px") {
    throw new Error(`Premium banner title was not applied: ${JSON.stringify(bannerTitle)}`);
  }

  const masthead = await page.locator(".archive-masthead").boundingBox();
  const bannerCards = await posterGeometry(".archive-highlight-card:visible");
  if (!masthead || bannerCards.length < 4 || bannerCards.length > 5) {
    throw new Error(`Banner should show 4–5 representative posters, got ${bannerCards.length}`);
  }
  if (masthead.height > 390) throw new Error(`Banner is still too tall: ${masthead.height}`);
  if (await page.locator(".archive-result-strip").count()) throw new Error("Redundant archive result strip is still rendered");
  const mastheadBounds = { left: masthead.x, top: masthead.y, right: masthead.x + masthead.width, bottom: masthead.y + masthead.height };
  bannerCards.forEach((card, index) => {
    if (card.objectFit !== "cover") throw new Error(`Banner poster ${index + 1} does not fill its frame with ${card.objectFit}`);
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

  await page.locator(".archive-poster-card").first().dispatchEvent("contextmenu", { button: 2, bubbles: true, cancelable: true, clientX: 420, clientY: 320 });
  await page.locator(".archive-context-menu").waitFor({ state: "visible" });
  const contextLabels = await page.locator(".archive-context-menu [role=menuitem]").allTextContents();
  for (const label of ["打开", "编辑", "复制为新场次", "删除"]) {
    if (!contextLabels.some((value) => value.includes(label))) throw new Error(`Archive context menu is missing ${label}`);
  }
  await page.keyboard.press("Escape");
  await page.locator(".archive-context-menu").waitFor({ state: "detached" });

  await archiveView("票夹", ".archive-wallet-card");
  const walletGeometry = await page.locator(".archive-wallet-card").first().evaluate((card) => {
    const cover = card.querySelector(".wallet-cover")?.getBoundingClientRect();
    const copy = card.querySelector(".wallet-copy")?.getBoundingClientRect();
    const actions = card.querySelector(".wallet-actions")?.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return {
      card: { left: rect.left, right: rect.right, width: rect.width },
      cover: cover ? { left: cover.left, right: cover.right, top: cover.top, bottom: cover.bottom } : null,
      copy: copy ? { left: copy.left, right: copy.right, top: copy.top, bottom: copy.bottom } : null,
      actions: actions ? { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom } : null,
    };
  });
  if (!walletGeometry.cover || !walletGeometry.copy || !walletGeometry.actions
    || walletGeometry.card.width < 520
    || walletGeometry.copy.left < walletGeometry.cover.right + 8
    || walletGeometry.actions.left < walletGeometry.copy.right + 4) {
    throw new Error(`Wallet columns overlap or are too narrow: ${JSON.stringify(walletGeometry)}`);
  }
  await page.screenshot({ path: `${outputDir}/03-wallet-desktop.png`, fullPage: true });
  await archiveView("票根", ".archive-ticket");
  const ticketGeometry = await page.locator(".archive-ticket").first().evaluate((card) => {
    const cover = card.querySelector(":scope > div");
    const image = cover?.querySelector("img");
    const cardRect = card.getBoundingClientRect();
    const coverRect = cover?.getBoundingClientRect();
    const sectionRect = card.querySelector(":scope > section")?.getBoundingClientRect();
    return {
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
      card: { top: cardRect.top, bottom: cardRect.bottom, left: cardRect.left },
      cover: coverRect ? { top: coverRect.top, bottom: coverRect.bottom, left: coverRect.left, right: coverRect.right } : null,
      section: sectionRect ? { top: sectionRect.top, bottom: sectionRect.bottom, left: sectionRect.left } : null,
    };
  });
  if (!ticketGeometry.cover || !ticketGeometry.section
    || ticketGeometry.objectFit !== "cover"
    || Math.abs(ticketGeometry.cover.top - ticketGeometry.card.top) > 2
    || Math.abs(ticketGeometry.cover.bottom - ticketGeometry.card.bottom) > 2
    || ticketGeometry.section.left < ticketGeometry.cover.right - 1) {
    throw new Error(`Ticket cover crop/alignment is invalid: ${JSON.stringify(ticketGeometry)}`);
  }
  const frostedTicket = await page.locator(".archive-ticket").first().evaluate((card) => ({
    backdrop: Boolean(card.querySelector(".archive-ticket-backdrop")),
    blur: getComputedStyle(card.querySelector(".archive-ticket-backdrop")).filter,
    glass: getComputedStyle(card.querySelector(".archive-ticket-content")).backdropFilter,
  }));
  if (!frostedTicket.backdrop || !frostedTicket.blur.includes("blur") || !frostedTicket.glass.includes("blur")) throw new Error(`Ticket is not frosted from its poster: ${JSON.stringify(frostedTicket)}`);
  await page.screenshot({ path: `${outputDir}/04-ticket-desktop.png`, fullPage: true });
  await archiveView("画报", ".showcase-card");
  const showcase = await page.locator(".archive-showcase").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const columns = Array.from(node.querySelectorAll(":scope > .showcase-column")).filter((item) => getComputedStyle(item).display !== "none");
    const last = columns.at(-1)?.getBoundingClientRect();
    return { display: getComputedStyle(node).display, gridColumns: getComputedStyle(node).gridTemplateColumns, gap: getComputedStyle(node).gap, columnCount: columns.length, widthUse: last ? (last.right - rect.left) / rect.width : 0 };
  });
  if (showcase.display !== "grid" || showcase.columnCount < 2 || parseFloat(showcase.gap) > 10 || showcase.widthUse < 0.96) throw new Error(`Showcase is not using balanced full-width columns: ${JSON.stringify(showcase)}`);
  await page.screenshot({ path: `${outputDir}/04b-showcase-dense.png`, fullPage: true });
  await page.locator(".sync-pill").click();
  await page.locator(".sync-action-menu").waitFor({ state: "visible", timeout: 5000 });
  const syncMenuText = await page.locator(".sync-action-menu").innerText();
  for (const label of ["立即同步", "从云端恢复", "刷新云端图片"]) if (!syncMenuText.includes(label)) throw new Error(`Sync menu is missing ${label}`);
  await page.locator(".sync-pill").click();
  await archiveView("列表", ".archive-list button");
await page.screenshot({ path: `${outputDir}/05-list-desktop.png`, fullPage: true });
await archiveView("城市/场馆", ".archive-venue-view");
await page.locator('[data-map-mode="offline-summary"]').waitFor({ state: "visible", timeout: 10000 });
const offlineMap = await page.locator('[data-map-mode="offline-summary"]').evaluate((map) => ({
  width: map.getBoundingClientRect().width,
  height: map.getBoundingClientRect().height,
  itemCount: map.querySelectorAll(".venue-offline-grid button").length,
  hasChinaPolygon: Boolean(map.querySelector(".china-map-land, .china-static-map")),
}));
if (offlineMap.width < 500 || offlineMap.height < 300 || offlineMap.itemCount < 1 || offlineMap.hasChinaPolygon) {
  throw new Error(`Offline city summary is invalid: ${JSON.stringify(offlineMap)}`);
}
await page.screenshot({ path: `${outputDir}/05b-offline-city-summary.png`, fullPage: true });
await archiveView("海报", ".archive-poster-card");

  await page.getByRole("button", { name: "制作分享图", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  const activeFormat = await page.locator(".share-format-control button.is-active").innerText();
  if (!activeFormat.includes("智能横版")) throw new Error(`Share studio did not open in smart landscape mode: ${activeFormat}`);
  const activeLimit = await page.locator(".share-count-control button.is-active").innerText();
  if (!activeLimit.includes("全部")) throw new Error(`Share studio should default to all records, got: ${activeLimit}`);
  const panelDensity = await page.locator(".share-studio-panel").evaluate((panel) => ({ scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight }));
  if (panelDensity.scrollHeight > panelDensity.clientHeight + 4) throw new Error(`Default share controls still require scrolling: ${JSON.stringify(panelDensity)}`);
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".share-export-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 30000 });

  await assertFixedPreviewFits("Wall");
  const wall = await assertSharePosters("Wall", ".share-layout-canvas-wall");
  const wallFill = wall.posters.reduce((sum, poster) => sum + poster.width * poster.height, 0) / (wall.canvas.width * wall.canvas.height);
  if (wallFill < 0.88) throw new Error(`Wall layout leaves too much empty space: ${wallFill.toFixed(3)}`);
  const wallEnvelope = {
    left: Math.min(...wall.posters.map((poster) => poster.left)),
    right: Math.max(...wall.posters.map((poster) => poster.right)),
    top: Math.min(...wall.posters.map((poster) => poster.top)),
    bottom: Math.max(...wall.posters.map((poster) => poster.bottom)),
  };
  if (Math.abs(wallEnvelope.left - wall.canvas.x) > 3
    || Math.abs(wallEnvelope.right - (wall.canvas.x + wall.canvas.width)) > 3
    || Math.abs(wallEnvelope.top - wall.canvas.y) > 3
    || Math.abs(wallEnvelope.bottom - (wall.canvas.y + wall.canvas.height)) > 3) {
    throw new Error(`Wall composition does not meet all four content edges: ${JSON.stringify({ wallEnvelope, canvas: wall.canvas })}`);
  }
  await page.screenshot({ path: `${outputDir}/06-share-wall-fit.png`, fullPage: true });

  await layoutButton("票根聚合").click();
  await page.locator(".share-ticket-card").first().waitFor({ state: "visible", timeout: 10000 });
  const ticketShareGeometry = await page.locator(".share-layout-canvas-tickets").evaluate((canvas) => ({
    cardCount: canvas.querySelectorAll(".share-ticket-card").length,
    backdropCount: canvas.querySelectorAll(".share-ticket-backdrop").length,
    overflow: getComputedStyle(canvas).overflow,
  }));
  if (ticketShareGeometry.cardCount < 3 || ticketShareGeometry.backdropCount !== ticketShareGeometry.cardCount) throw new Error(`Ticket share layout is incomplete: ${JSON.stringify(ticketShareGeometry)}`);
  const ticketReadability = await page.locator(".share-ticket-card").first().evaluate((card) => {
    const rect = card.getBoundingClientRect();
    const poster = card.querySelector(".share-ticket-poster")?.getBoundingClientRect();
    const title = card.querySelector("h3");
    const meta = card.querySelector("dl");
    return {
      aspect: rect.width / rect.height,
      titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      metaSize: meta ? parseFloat(getComputedStyle(meta).fontSize) : 0,
      posterRatio: poster ? poster.height / Math.max(1, poster.width) : 0,
    };
  });
  if (ticketReadability.titleSize < 18 || ticketReadability.metaSize < 11 || ticketReadability.posterRatio < 1.05) {
    throw new Error(`Ticket share readability regressed: ${JSON.stringify(ticketReadability)}`);
  }
  await assertFixedPreviewFits("Ticket aggregation");
  await page.screenshot({ path: `${outputDir}/06b-share-ticket-aggregation.png`, fullPage: true });

  for (const label of ["智能竖版", "横版 4:3", "横版 16:9", "竖版 3:4", "竖版 9:16", "方形 1:1"]) {
    await page.locator(".share-format-control button").filter({ hasText: label }).click();
    await page.waitForTimeout(80);
    const ticketGeometry = await page.locator(".share-ticket-card").evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      const posterNode = card.querySelector(".share-ticket-poster");
      const poster = posterNode?.getBoundingClientRect();
      const image = posterNode?.querySelector("img");
      const title = card.querySelector("h3");
      const meta = card.querySelector("dl");
      const frameRatio = poster ? poster.width / Math.max(1, poster.height) : 0;
      const sourceRatio = image instanceof HTMLImageElement && image.naturalWidth && image.naturalHeight
        ? image.naturalWidth / image.naturalHeight
        : null;
      return {
        width: rect.width,
        height: rect.height,
        frameRatio,
        sourceRatio,
        ratioError: sourceRatio ? Math.abs(Math.log(Math.max(0.01, frameRatio / sourceRatio))) : 0,
        titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
        metaSize: meta ? parseFloat(getComputedStyle(meta).fontSize) : 0,
      };
    }));
    if (!ticketGeometry.length
      || ticketGeometry.some((item) => item.ratioError > 0.2 || item.titleSize < 18 || item.metaSize < 11 || item.height < 70)) {
      throw new Error(`${label} ticket layout became unreadable or distorted: ${JSON.stringify(ticketGeometry)}`);
    }
    await assertFixedPreviewFits(`Ticket ${label}`);
  }
  await page.locator(".share-format-control button").filter({ hasText: "智能横版" }).click();
  await layoutButton("密集海报墙").click();

  await page.locator(".share-format-control button").filter({ hasText: "智能竖版" }).click();
  await page.waitForTimeout(120);
  const portraitSmart = await page.locator(".share-preview").boundingBox();
  if (!portraitSmart || portraitSmart.height <= portraitSmart.width) throw new Error(`Smart portrait did not produce a portrait canvas: ${JSON.stringify(portraitSmart)}`);
  await page.locator(".share-format-control button").filter({ hasText: "智能横版" }).click();
  await page.waitForTimeout(120);
  const landscapeSmart = await page.locator(".share-preview").boundingBox();
  if (!landscapeSmart || landscapeSmart.width <= landscapeSmart.height) throw new Error(`Smart landscape did not produce a landscape canvas: ${JSON.stringify(landscapeSmart)}`);

  const fixedFormats = [
    ["横版 4:3", 4 / 3],
    ["横版 16:9", 16 / 9],
    ["竖版 3:4", 3 / 4],
    ["竖版 9:16", 9 / 16],
    ["方形 1:1", 1],
  ];
  for (const [label, expectedRatio] of fixedFormats) {
    await page.locator(".share-format-control button").filter({ hasText: label }).click();
    await page.waitForTimeout(100);
    const preview = await page.locator(".share-preview").boundingBox();
    if (!preview || Math.abs(preview.width / preview.height - expectedRatio) > 0.025) {
      throw new Error(`${label} ratio is wrong: ${JSON.stringify(preview)}`);
    }
    const fixedWall = await assertSharePosters(label, ".share-layout-canvas-wall");
    const envelope = {
      left: Math.min(...fixedWall.posters.map((poster) => poster.left)),
      right: Math.max(...fixedWall.posters.map((poster) => poster.right)),
      top: Math.min(...fixedWall.posters.map((poster) => poster.top)),
      bottom: Math.max(...fixedWall.posters.map((poster) => poster.bottom)),
    };
    if (Math.abs(envelope.left - fixedWall.canvas.x) > 3
      || Math.abs(envelope.right - (fixedWall.canvas.x + fixedWall.canvas.width)) > 3
      || Math.abs(envelope.top - fixedWall.canvas.y) > 3
      || Math.abs(envelope.bottom - (fixedWall.canvas.y + fixedWall.canvas.height)) > 3) {
      throw new Error(`${label} wall does not fill all four edges: ${JSON.stringify({ envelope, canvas: fixedWall.canvas })}`);
    }
  }
  await page.locator(".share-format-control button").filter({ hasText: "智能横版" }).click();

  const fitText = await page.locator(".share-preview-toolbar strong").textContent();
  await page.getByRole("button", { name: "放大预览", exact: true }).click();
  const zoomText = await page.locator(".share-preview-toolbar strong").textContent();
  if (fitText === zoomText) throw new Error("Preview zoom control did not change scale");
  await page.getByRole("button", { name: /适应窗口/ }).click();
  await assertFixedPreviewFits("Wall after fit reset");

  await layoutButton("时间长卷").click();
  await page.locator(".share-timeline-band").first().waitFor({ state: "visible", timeout: 10000 });
  const timelineTypography = await page.locator(".share-timeline-band > header b").evaluateAll((labels) => labels.map((label) => parseFloat(getComputedStyle(label).fontSize)));
  if (!timelineTypography.length || timelineTypography.some((size) => size < 28)) {
    throw new Error(`Timeline year labels are too small: ${timelineTypography.join(",")}`);
  }
  await assertFixedPreviewFits("Timeline");
  await assertSharePosters("Timeline", ".share-layout-timeline .share-layout-canvas");
  await page.screenshot({ path: `${outputDir}/07-share-timeline.png`, fullPage: true });

  await layoutButton("编目杂志").click();
  await page.locator(".share-layout-canvas-magazine .share-layout-poster.is-hero").waitFor({ state: "visible", timeout: 10000 });
  const magazine = await assertSharePosters("Magazine", ".share-layout-canvas-magazine");
  const hero = magazine.posters[0];
  const regularAreas = magazine.posters.slice(1).map((poster) => poster.width * poster.height).sort((a, b) => a - b);
  const median = regularAreas[Math.floor(regularAreas.length / 2)] || 1;
  if (hero.width <= 0 || hero.height <= 0 || median <= 0) throw new Error("Magazine layout did not render valid poster geometry");
  const magazineFill = magazine.posters.reduce((sum, poster) => sum + poster.width * poster.height, 0) / (magazine.canvas.width * magazine.canvas.height);
  if (magazineFill < 0.72) throw new Error(`Magazine layout leaves too much empty space: ${magazineFill.toFixed(3)}`);
  const magazineFeatureCount = await page.locator(".share-layout-canvas-magazine .share-layout-poster.is-feature").count();
  if (magazine.posters.length >= 4 && magazineFeatureCount < 2) throw new Error(`Magazine did not create multiple feature posters: ${magazineFeatureCount}`);
  const magazineLeft = Math.min(...magazine.posters.map((poster) => poster.left));
  const magazineRight = Math.max(...magazine.posters.map((poster) => poster.right));
  const magazineTop = Math.min(...magazine.posters.map((poster) => poster.top));
  const magazineBottom = Math.max(...magazine.posters.map((poster) => poster.bottom));
  const magazineWidthUse = (magazineRight - magazineLeft) / magazine.canvas.width;
  const magazineHeightUse = (magazineBottom - magazineTop) / magazine.canvas.height;
  if (magazineWidthUse < 0.82 || magazineHeightUse < 0.78) {
    throw new Error(`Magazine composition collapsed into a narrow strip: ${JSON.stringify({ magazineWidthUse, magazineHeightUse })}`);
  }
  await page.screenshot({ path: `${outputDir}/08-share-magazine-dense.png`, fullPage: true });

  await layoutButton("城市路线").click();
  await page.locator(".share-amap-panel").waitFor({ state: "visible", timeout: 10000 });
  if (await page.locator(".share-coordinate-field, .share-city-bands").count()) throw new Error("Legacy fabricated coordinate field is still rendered");
  const cityPosterCount = await page.locator(".share-city-poster-grid .share-layout-poster").count();
  if (cityPosterCount < 3) throw new Error(`City route poster field is too sparse: ${cityPosterCount}`);
  const mapCopy = await page.locator(".share-amap-panel").innerText();
  if (!mapCopy.includes("高德")) throw new Error(`City route does not identify the AMap surface: ${mapCopy}`);
  if (mapCopy.includes("需要高德地图") && !mapCopy.includes("去配置高德地图")) {
    throw new Error("City route missing-key state has no direct configuration action");
  }
  await assertFixedPreviewFits("City route");
  await page.screenshot({ path: `${outputDir}/09-share-city-amap.png`, fullPage: true });

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
  await page.waitForTimeout(260);
  const mobileRail = await page.locator(".experience-rail").boundingBox();
  if (mobileRail && mobileRail.x + mobileRail.width > 1) {
    throw new Error(`Mobile navigation rail is covering content by default: ${JSON.stringify(mobileRail)}`);
  }
  await page.locator(".experience-mobile-nav").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".archive-highlight-card-1").waitFor({ state: "visible", timeout: 15000 });
  const mobileCards = await posterGeometry(".archive-highlight-card:visible");
  const mobileMasthead = await page.locator(".archive-masthead").boundingBox();
  if (!mobileMasthead || mobileCards.length < 3) throw new Error("Mobile banner posters are missing");
  const mobileBounds = { left: mobileMasthead.x, top: mobileMasthead.y, right: mobileMasthead.x + mobileMasthead.width, bottom: mobileMasthead.y + mobileMasthead.height };
  mobileCards.forEach((card, index) => assertContained(`Mobile banner poster ${index + 1}`, card, mobileBounds, 3));
  await page.screenshot({ path: `${outputDir}/13-banner-mobile.png`, fullPage: true });

  // Mobile editor regression: the native file chooser must be wired directly to
  // the media input, and a selected image must immediately expose local processing state.
  await page.locator(".archive-poster-card").first().dispatchEvent("contextmenu", {
    button: 2,
    bubbles: true,
    cancelable: true,
    clientX: 180,
    clientY: 420,
  });
  await page.locator(".archive-context-menu").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".archive-context-menu [role=menuitem]").filter({ hasText: "编辑" }).click();
  await page.locator(".record-editor-v2").waitFor({ state: "visible", timeout: 5000 });
  const posterPicker = page.locator('input[data-media-kind="poster"]');
  await posterPicker.waitFor({ state: "attached", timeout: 5000 });
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 2000 });
  await posterPicker.click({ force: true });
  const chooser = await chooserPromise;
  await chooser.setFiles([]);
  await posterPicker.setInputFiles({
    name: "mobile-picker-test.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".media-editor-card-v2"))
    .some((card) => card.textContent?.includes("主海报") && card.textContent?.includes("本机已准备")), null, { timeout: 10000 });
  const mobilePosterEditor = page.locator(".media-editor-card-v2").filter({ hasText: "主海报" }).first();
  if (await mobilePosterEditor.locator("img").count() < 1 || await mobilePosterEditor.locator(".media-editor-sync-badge-v2").count() < 1) {
    throw new Error("Mobile media editor did not expose the selected poster preview and sync state");
  }
  await page.screenshot({ path: `${outputDir}/13b-editor-mobile-media.png`, fullPage: true });
  await page.locator('.record-editor-v2 button[aria-label="关闭"]').click();
  await page.locator(".record-editor-v2").waitFor({ state: "detached", timeout: 5000 });

  await archiveView("票夹", ".archive-wallet-card");
  const walletReadability = await page.locator(".archive-wallet-card").first().evaluate((card) => {
    const facts = card.querySelector(".archive-card-facts");
    const artist = card.querySelector(".archive-card-artist");
    const ticketLine = card.querySelector(".archive-ticket-line");
    const rect = card.getBoundingClientRect();
    return {
      height: rect.height,
      factsVisible: facts ? getComputedStyle(facts).display !== "none" && facts.getBoundingClientRect().height > 20 : false,
      artistSize: artist ? parseFloat(getComputedStyle(artist).fontSize) : 0,
      ticketLineWidth: ticketLine?.getBoundingClientRect().width || 0,
    };
  });
  if (walletReadability.height < 170 || !walletReadability.factsVisible || walletReadability.artistSize < 11 || walletReadability.ticketLineWidth < 70) {
    throw new Error(`Mobile wallet metadata became unreadable: ${JSON.stringify(walletReadability)}`);
  }
  await page.screenshot({ path: `${outputDir}/14-wallet-mobile.png`, fullPage: true });

  await archiveView("票根", ".archive-ticket");
  const mobileTicket = await page.locator(".archive-ticket").first().evaluate((card) => {
    const rect = card.getBoundingClientRect();
    const grid = card.parentElement?.getBoundingClientRect();
    const facts = card.querySelector(".archive-card-facts");
    const ticketLine = card.querySelector(".archive-ticket-line");
    const artist = card.querySelector(".archive-card-artist");
    return {
      widthUse: grid ? rect.width / grid.width : 0,
      factsVisible: facts ? getComputedStyle(facts).display !== "none" && facts.getBoundingClientRect().height > 24 : false,
      artistSize: artist ? parseFloat(getComputedStyle(artist).fontSize) : 0,
      ticketLineWidth: ticketLine?.getBoundingClientRect().width || 0,
    };
  });
  if (mobileTicket.widthUse < 0.92 || !mobileTicket.factsVisible || mobileTicket.artistSize < 11 || mobileTicket.ticketLineWidth < 90) {
    throw new Error(`Mobile ticket view must stay single-column and readable: ${JSON.stringify(mobileTicket)}`);
  }
  await page.screenshot({ path: `${outputDir}/15-ticket-mobile.png`, fullPage: true });

  await archiveView("列表", ".archive-list button");
  const mobileList = await page.locator(".archive-list button").first().evaluate((row) => {
    const artist = row.querySelector(".archive-card-artist");
    const ticket = row.querySelector(".archive-list-ticket");
    const seat = ticket?.querySelector("small");
    const rowRect = row.getBoundingClientRect();
    const ticketRect = ticket?.getBoundingClientRect();
    return {
      height: rowRect.height,
      artistSize: artist ? parseFloat(getComputedStyle(artist).fontSize) : 0,
      ticketVisible: Boolean(ticketRect && ticketRect.height > 10),
      seatVisible: Boolean(seat && seat.getBoundingClientRect().width > 4),
      ticketContained: Boolean(ticketRect
        && ticketRect.left >= rowRect.left
        && ticketRect.right <= rowRect.right + 1
        && ticketRect.top >= rowRect.top
        && ticketRect.bottom <= rowRect.bottom + 1),
    };
  });
  if (mobileList.height < 112 || mobileList.artistSize < 11 || !mobileList.ticketVisible || !mobileList.seatVisible || !mobileList.ticketContained) {
    throw new Error(`Mobile list metadata is incomplete or clipped: ${JSON.stringify(mobileList)}`);
  }
  await page.screenshot({ path: `${outputDir}/16-list-mobile.png`, fullPage: true });

  const mobileShareButton = page.locator(".archive-command-actions button").last();
  await mobileShareButton.scrollIntoViewIfNeeded();
  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-format-control button").filter({ hasText: "竖版 3:4" }).click();
  await page.locator(".share-preview-area.is-fixed").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });
  await assertFixedPreviewFits("Mobile share wall");
  await page.screenshot({ path: `${outputDir}/17-share-mobile-fit.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".share-studio-stage").waitFor({ state: "detached", timeout: 10000 });
} finally {
  await browser.close();
}
