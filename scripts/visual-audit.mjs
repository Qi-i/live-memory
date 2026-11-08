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
    const foreground = figure.querySelector(".share-poster-foreground");
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      objectFit: image ? getComputedStyle(image).objectFit : "fallback",
      foregroundObjectFit: foreground ? getComputedStyle(foreground).objectFit : "fallback",
      preserved: figure.classList.contains("is-poster-preserved"),
    };
  }));
}

async function assertSharePosters(label, canvasSelector) {
  const canvas = await page.locator(canvasSelector).boundingBox();
  const posters = await posterGeometry(`${canvasSelector} .share-layout-poster`);
  if (!canvas || posters.length < 3) throw new Error(`${label} did not render enough posters`);
  const parent = { left: canvas.x, top: canvas.y, right: canvas.x + canvas.width, bottom: canvas.y + canvas.height };
  posters.forEach((poster, index) => {
    const frameAspect = poster.width / Math.max(1, poster.height);
    if (frameAspect > 0.87) {
      if (!poster.preserved || poster.foregroundObjectFit !== "contain") {
        throw new Error(`${label} poster ${index + 1} became a wide crop without full-poster preservation: ${JSON.stringify(poster)}`);
      }
    } else if (!["cover", "fallback"].includes(poster.foregroundObjectFit)) {
      throw new Error(`${label} poster ${index + 1} has unexpected foreground fit: ${poster.foregroundObjectFit}`);
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
    text: heading.textContent?.trim(),
    fontSize: parseFloat(getComputedStyle(heading).fontSize),
    pseudoContent: getComputedStyle(heading, "::before").content,
  }));
  if (bannerTitle.text !== "把现场，留在时间里" || bannerTitle.fontSize < 24 || bannerTitle.pseudoContent !== "none") {
    throw new Error(`Semantic banner title is not readable: ${JSON.stringify(bannerTitle)}`);
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

  const shareRefetches = [];
  await page.route("**/demo/**", (route) => {
    shareRefetches.push(route.request().url());
    void route.abort("failed");
  });
  await page.getByRole("button", { name: "生成分享图", exact: true }).click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-preview-preparing").waitFor({ state: "detached", timeout: 30000 }).catch(() => undefined);
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 30000 });
  if (shareRefetches.length) throw new Error(`Opening Share Studio refetched posters already present in the shared media cache: ${shareRefetches.join(",")}`);
  if (await page.locator(".share-layout-canvas-wall .share-poster-fallback").count()) {
    throw new Error("Share Studio mounted the wall before all cached primary posters were ready");
  }
  const firstPaintPosterState = await page.locator(".share-layout-canvas-wall .share-poster-foreground").evaluateAll((images) => images.map((image) => ({
    complete: image instanceof HTMLImageElement ? image.complete : false,
    width: image instanceof HTMLImageElement ? image.naturalWidth : 0,
    height: image instanceof HTMLImageElement ? image.naturalHeight : 0,
  })));
  if (!firstPaintPosterState.length || firstPaintPosterState.some((image) => !image.complete || !image.width || !image.height)) {
    throw new Error(`Share wall mounted before poster decoding completed: ${JSON.stringify(firstPaintPosterState)}`);
  }
  await page.unroute("**/demo/**");
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
  const wideWallPosters = wall.posters.filter((poster) => poster.width / Math.max(1, poster.height) > 0.87);
  if (wideWallPosters.length) throw new Error(`Wall poster slots became horizontal strips: ${JSON.stringify(wideWallPosters)}`);
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
    const wideFixedWallPosters = fixedWall.posters.filter((poster) => poster.width / Math.max(1, poster.height) > 0.87);
    if (wideFixedWallPosters.length) {
      throw new Error(`${label} wall produced horizontal poster strips: ${JSON.stringify(wideFixedWallPosters)}`);
    }
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
  const timelinePosters = await assertSharePosters("Timeline", ".share-layout-timeline .share-layout-canvas");
  if (timelinePosters.posters.some((poster) => poster.width / Math.max(1, poster.height) > 0.87)) {
    throw new Error(`Timeline poster slots became horizontal strips: ${JSON.stringify(timelinePosters.posters)}`);
  }
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
  const cityPosterGeometry = await posterGeometry(".share-city-poster-grid .share-layout-poster");
  if (cityPosterGeometry.some((poster) => poster.width / Math.max(1, poster.height) > 0.87)) {
    throw new Error(`City poster slots became horizontal strips: ${JSON.stringify(cityPosterGeometry)}`);
  }
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
  const liquidMaterial = await page.locator(".experience-topbar").evaluate((element) => {
    const style = getComputedStyle(element);
    return { filter: style.backdropFilter || style.webkitBackdropFilter, radius: style.borderRadius };
  });
  if (!liquidMaterial.filter || liquidMaterial.filter === "none") {
    throw new Error("Liquid Stage topbar should use functional translucent material: " + JSON.stringify(liquidMaterial));
  }


  // Single-event keepsake: actual Canvas-generated PNG, not an archive screenshot.
  await page.locator(".archive-poster-card .archive-poster-copy").first().click();
  await page.locator(".record-detail-v2").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "生成单场纪念分享图" }).click();
  await page.locator(".keepsake-preview-image").waitFor({ state: "visible", timeout: 25000 });
  const eventCardDimensions = await page.locator(".keepsake-preview-image").evaluate((img) => ({
    width: img.naturalWidth, height: img.naturalHeight,
  }));
  if (eventCardDimensions.width !== 1080 || eventCardDimensions.height !== 1350) {
    throw new Error("Single-event card must render native 4:5 PNG: " + JSON.stringify(eventCardDimensions));
  }
  await page.screenshot({ path: outputDir + "/13c-keepsake-concert-feed-mobile.png", fullPage: true });
  await page.getByRole("button", { name: /手机长图 9:16/ }).click();
  await page.waitForFunction(() => {
    const image = document.querySelector(".keepsake-preview-image");
    return image?.naturalWidth === 1080 && image?.naturalHeight === 1920;
  }, null, { timeout: 25000 });
  const [keepsakeDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: "下载 PNG" }).click(),
  ]);
  await keepsakeDownload.saveAs(outputDir + "/13d-keepsake-concert-story.png");
  await page.getByRole("button", { name: "关闭分享编辑器" }).click();
  await page.locator(".overlay-header-v2 > button").first().click();

  // The statistics screen also has a dedicated shareable canvas.
  await page.locator(".experience-mobile-nav button").filter({ hasText: "统计" }).click();
  await page.getByRole("group", { name: "选择统计年份" }).getByRole("button", { name: /2024/ }).click();
  const selectedYearCount = (await page.locator(".statistics-metrics article").first().locator("strong").textContent())?.trim();
  if (selectedYearCount !== "2") throw new Error("Year filter did not narrow demo archive to two 2024 concerts: " + selectedYearCount);
  const firstChart = await page.locator(".statistics-panel").first().innerText();
  if (!firstChart.includes("2024-03") || !firstChart.includes("2024-08")) {
    throw new Error("Monthly trend did not retain chronological 2024 observations: " + firstChart);
  }
  await page.screenshot({ path: outputDir + "/13e-statistics-2024-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "生成回顾分享图" }).click();
  await page.locator(".keepsake-preview-image").waitFor({ state: "visible", timeout: 25000 });
  await page.screenshot({ path: outputDir + "/13e-keepsake-recap-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "关闭分享编辑器" }).click();
  await page.locator(".experience-mobile-nav button").filter({ hasText: "档案" }).click();
  await page.locator(".archive-poster-card").first().waitFor({ state: "visible", timeout: 10000 });

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
  const editorSections = await page.locator(".editor-section-v3").count();
  if (editorSections !== 4) throw new Error("Record editor must expose four clear workflow sections: " + editorSections);
  const editorLayout = await page.locator(".record-editor-v2").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left, right: rect.right, viewport: innerWidth };
  });
  if (editorLayout.x < -1 || editorLayout.right > editorLayout.viewport + 1) {
    throw new Error("Editor overflows the mobile viewport: " + JSON.stringify(editorLayout));
  }
  await page.screenshot({ path: `${outputDir}/13b-editor-mobile-media.png`, fullPage: true });
  await page.locator('.record-editor-v2 button[aria-label="关闭"]').click();
  await page.getByRole("alertdialog", { name: "放弃这次编辑？" }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: "放弃修改" }).click();
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

  // Device-only use must persist data across a reload without a public account.
  const localContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    serviceWorkers: "block",
  });
  const localPage = await localContext.newPage();
  await localPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await localPage.getByRole("button", { name: "使用本机档案" }).click();
  await localPage.locator(".experience-shell").waitFor({ state: "visible", timeout: 12000 });
  await localPage.getByRole("button", { name: "新增", exact: true }).click();
  await localPage.locator(".record-editor-v2").waitFor({ state: "visible", timeout: 10000 });
  await localPage.locator(".editor-field-v2").filter({ hasText: "演出名称" }).locator("input").fill("本机存储回归测试现场");
  await localPage.locator(".editor-field-v2").filter({ hasText: "日期" }).locator("input").fill("2026-11-08");
  await localPage.getByRole("button", { name: "保存记录" }).click();
  await localPage.locator(".record-detail-v2").waitFor({ state: "visible", timeout: 10000 });
  await localPage.locator(".overlay-header-v2 > button").first().click();
  await localPage.reload({ waitUntil: "domcontentloaded" });
  await localPage.locator(".archive-poster-card").filter({ hasText: "本机存储回归测试现场" }).waitFor({ state: "visible", timeout: 15000 });
  const emptyHeroHeight = await localPage.locator(".archive-highlight-empty").evaluate((element) => element.getBoundingClientRect().height);
  if (emptyHeroHeight > 135) throw new Error("No-poster local archive still wastes space on a giant placeholder: " + emptyHeroHeight);
  const deviceFlag = await localPage.evaluate(() => localStorage.getItem("live-memory-device-only-v1"));
  if (deviceFlag !== "1") throw new Error("Standalone local archive did not preserve its persistent mode flag");
  await localPage.screenshot({ path: outputDir + "/18-device-local-reopened-mobile.png", fullPage: true });

  // Importing backup data should preview without changing IndexedDB, then
  // add new IDs while preserving existing records with matching IDs.
  const savedId = await localPage.locator(".archive-poster-card").first().getAttribute("data-archive-record-id");
  if (!savedId) throw new Error("Local regression record is missing its stable ID");
  await localPage.locator(".experience-mobile-nav button").filter({ hasText: "设置" }).click();
  const backupFile = {
    name: "audit-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "live-memory", version: 3, records: [
      { id: savedId, title: "不得覆盖原档案", date: "2026-11-08", category: "concert", media: [] },
      { id: "audit-import-20261108", title: "导入的新演出", date: "2026-10-01", category: "concert", tags: ["值得回顾"], media: [] },
    ] })),
  };
  await localPage.locator(".data-action-grid-v2 input[type=file]").setInputFiles(backupFile);
  await localPage.getByRole("region", { name: "JSON 备份导入预览" }).waitFor({ state: "visible", timeout: 10000 });
  const previewCounts = await localPage.locator(".backup-import-counts strong").allTextContents();
  if (previewCounts.join(",") !== "1,1,1") throw new Error("Incorrect import preview counts: " + previewCounts.join(","));
  await localPage.screenshot({ path: outputDir + "/19-safe-import-preview-mobile.png", fullPage: true });
  await localPage.getByRole("button", { name: "确认新增 1 条" }).click();
  await localPage.getByRole("region", { name: "JSON 备份导入预览" }).waitFor({ state: "detached", timeout: 10000 });
  await localPage.reload({ waitUntil: "domcontentloaded" });
  await localPage.locator(".experience-mobile-nav button").filter({ hasText: "档案" }).click();
  await localPage.locator(".archive-poster-card").filter({ hasText: "本机存储回归测试现场" }).waitFor({ state: "visible", timeout: 15000 });
  await localPage.locator(".archive-poster-card").filter({ hasText: "导入的新演出" }).waitFor({ state: "visible", timeout: 15000 });
  if (await localPage.locator(".archive-poster-card").filter({ hasText: "不得覆盖原档案" }).count()) {
    throw new Error("Import silently overwrote an existing local record");
  }

  // Favorites and tags must filter the actual archive, and the empty state
  // must have a visible single-click recovery action.
  await localPage.getByRole("button", { name: "仅显示收藏演出" }).click();
  await localPage.locator(".archive-filter-empty").waitFor({ state: "visible", timeout: 10000 });
  await localPage.getByRole("button", { name: "清空所有筛选条件" }).click();
  await localPage.locator(".archive-command-actions button").filter({ hasText: "筛选" }).click();
  await localPage.locator(".archive-filter-row").filter({ hasText: "标签" }).locator("button").filter({ hasText: "值得回顾" }).click();
  const tagCards = await localPage.locator(".archive-poster-card").count();
  if (tagCards !== 1) throw new Error("Tag filtering did not narrow the archive: " + tagCards);
  await localPage.locator(".archive-search input").fill("definitely-not-a-real-concert");
  await localPage.locator(".archive-filter-empty").waitFor({ state: "visible", timeout: 10000 });
  await localPage.screenshot({ path: outputDir + "/20-archive-search-empty-mobile.png", fullPage: true });
  await localPage.getByRole("button", { name: "清空所有筛选条件" }).click();
  if (await localPage.locator(".archive-poster-card").count() !== 2) {
    throw new Error("Clearing filters did not restore all saved and imported records");
  }

  // Theme switching must work on the same device without changing archive data.
  await localPage.locator(".experience-mobile-nav button").filter({ hasText: "设置" }).click();
  await localPage.getByRole("button", { name: "深色", exact: true }).click();
  await localPage.getByRole("button", { name: /Liquid Stage · 液态舞台/ }).click();
  const darkTheme = await localPage.evaluate(() => ({
    appearance: document.documentElement.dataset.appearance,
    theme: document.documentElement.dataset.visualTheme,
  }));
  if (darkTheme.appearance !== "dark" || darkTheme.theme !== "aurora") {
    throw new Error("Dark Liquid Stage theme did not activate: " + JSON.stringify(darkTheme));
  }
  await localPage.screenshot({ path: outputDir + "/21-liquid-stage-dark-mobile.png", fullPage: true });
  await localPage.getByRole("button", { name: /Editorial · 纸质画册/ }).click();
  const editorial = await localPage.locator(".experience-topbar").evaluate((element) => ({
    theme: document.documentElement.dataset.visualTheme,
    filter: getComputedStyle(element).backdropFilter,
  }));
  if (editorial.theme !== "editorial" || editorial.filter !== "none") {
    throw new Error("Editorial did not remove glass effect: " + JSON.stringify(editorial));
  }
  await localPage.screenshot({ path: outputDir + "/22-editorial-dark-mobile.png", fullPage: true });
  await localContext.close();

  if (process.env.V3_PREVIEW_AUDIT === "1") {
    // A separate architecture preview, with no login or personal data access.
    // The V3 layout is tested by measured geometry, not CSS string matches.
    for (const [width, height] of [[1600, 1000], [1024, 820], [390, 844]]) {
      const v3Context = await browser.newContext({
        viewport: { width, height }, serviceWorkers: "block",
      });
      const v3Page = await v3Context.newPage();
      const previewUrl = new URL(baseUrl);
      previewUrl.searchParams.set("v3-preview", "1");
      await v3Page.goto(previewUrl.toString(), { waitUntil: "domcontentloaded" });
      await v3Page.locator('[data-ui-system="v3"]').waitFor({ state: "visible", timeout: 15000 });
      await v3Page.locator(".v3-portrait-frame").first().waitFor({ state: "visible", timeout: 10000 });
      const layout = await v3Page.evaluate(() => {
        const bounds = (selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          if (!rect) throw new Error("Missing V3 element " + selector);
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
        };
        return {
          hero: bounds(".v3-stage-hero"),
          artwork: bounds(".v3-portrait-frame"),
          map: bounds(".v3-map-stage"),
          side: bounds(".v3-map-side"),
          tools: bounds(".v3-action-toolbar"),
          viewport: innerWidth,
          workspaceScrollWidth: document.querySelector(".v3-workspace-content")?.scrollWidth,
          workspaceWidth: document.querySelector(".v3-workspace-content")?.clientWidth,
          fit: getComputedStyle(document.querySelector(".v3-portrait-frame img")).objectFit,
          actionBounds: [...document.querySelectorAll(".v3-action-toolbar button")].map((el) => {
            const rect = el.getBoundingClientRect();
            return { x: rect.x, right: rect.right };
          }),
        };
      });
      const ratio = layout.artwork.width / layout.artwork.height;
      if (ratio > 0.75 || ratio < 0.59 || layout.artwork.height < 150 || layout.fit !== "contain") {
        throw new Error("V3 portrait artwork was crushed or cropped at " + width + "px: " + JSON.stringify(layout));
      }
      if (layout.workspaceScrollWidth > layout.workspaceWidth + 3) {
        throw new Error("V3 workspace has horizontal overflow at " + width + "px: " + JSON.stringify(layout));
      }
      if (layout.actionBounds.some((rect) => rect.x < layout.tools.x - 2 || rect.right > layout.tools.right + 2)) {
        throw new Error("V3 action toolbar clipped a button at " + width + "px: " + JSON.stringify(layout));
      }
      if (width > 800 && Math.abs(layout.map.height - layout.side.height) > 2) {
        throw new Error("V3 map and ranking panel heights diverged: " + JSON.stringify(layout));
      }
      if (width === 1600 && layout.hero.height < 320) {
        throw new Error("V3 banner too flat for portrait artwork: " + JSON.stringify(layout));
      }

      // Status updates live in the sidebar and cannot displace the main hero.
      if (width > 800) {
        const beforeY = await v3Page.locator(".v3-stage-hero").evaluate((el) => el.getBoundingClientRect().top);
        await v3Page.getByRole("button", { name: "模拟云端更新" }).click();
        const afterY = await v3Page.locator(".v3-stage-hero").evaluate((el) => el.getBoundingClientRect().top);
        if (Math.abs(afterY - beforeY) > 1) {
          throw new Error("V3 sync event moved the content region by " + (afterY - beforeY) + "px");
        }
      }

      await v3Page.screenshot({ path: outputDir + "/23-v3-shell-" + width + ".png", fullPage: true });
      await v3Page.locator(".v3-preview-city-list > button").filter({ hasText: "北京" }).click();
      const panelFit = await v3Page.evaluate(() => {
        const map = document.querySelector(".v3-map-stage").getBoundingClientRect();
        const panel = document.querySelector(".v3-map-detail-layer").getBoundingClientRect();
        return { left: panel.left >= map.left - 1, right: panel.right <= map.right + 1,
          top: panel.top >= map.top - 1, bottom: panel.bottom <= map.bottom + 1 };
      });
      if (Object.values(panelFit).some((v) => !v)) {
        throw new Error("V3 map city detail exceeds map geometry at " + width + "px: " + JSON.stringify(panelFit));
      }
      await v3Page.locator(".v3-map-stage").scrollIntoViewIfNeeded();
      await v3Page.screenshot({ path: outputDir + "/24-v3-city-details-" + width + ".png", fullPage: true });
      await v3Page.getByRole("button", { name: "关闭城市详情" }).click();
      await v3Page.locator(".v3-map-detail-layer").waitFor({ state: "detached" });
      await v3Context.close();
    }
    console.log("V3 geometry audit passed: 1600/1024/390 viewports, portrait originals, map alignment, status non-reflow and accessible city panels.");
  }
} finally {
  await browser.close();
}
