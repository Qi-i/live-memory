import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const domain = await server.ssrLoadModule("/src/domain.ts");
  const storage = await server.ssrLoadModule("/src/storage.ts");
  const syncModel = await server.ssrLoadModule("/src/syncModel.ts");
  const supabase = await server.ssrLoadModule("/src/supabase.ts");
  const accountLogin = await server.ssrLoadModule("/src/accountLogin.ts");
  const importers = await server.ssrLoadModule("/src/importers.ts");
  const posterRegistry = await server.ssrLoadModule("/src/posterRegistry.ts");

  assert.equal(domain.validateUsername("Qi2026"), "qi2026");
  assert.throws(() => domain.validateUsername("abc"));
  assert.throws(() => domain.validateUsername("qi_name"));
  assert.equal(accountLogin.validateLoginIdentifier("Qi2026"), "qi2026");
  assert.equal(accountLogin.validateLoginIdentifier("Qi.User+live@example.com"), "qi.user+live@example.com");
  assert.throws(() => accountLogin.validateLoginIdentifier("not an identifier"));
  assert.equal(domain.validatePassword("12345678"), "12345678");
  assert.throws(() => domain.validatePassword("1234567"));
  assert.equal(domain.validateRecoveryEmail("qi@example.com"), "qi@example.com");
  assert.throws(() => domain.validateRecoveryEmail("qi.example.com"));
  assert.equal(domain.normalizeExternalUrl("javascript:alert(1)"), "");
  assert.equal(domain.normalizeExternalUrl("https://m.damai.cn/shows/item.html?itemId=1"), "https://m.damai.cn/shows/item.html?itemId=1");

  assert.equal(
    importers.cleanupDamaiTitle("【北京】汪苏泷2026「明日世界」演唱会-北京站【网上订票】- 大麦网"),
    "【北京】汪苏泷2026「明日世界」演唱会-北京站",
  );
  const desktopDamaiUrl = "https://detail.damai.cn/item.htm?spm=a2oeg.search_category.0.0.2d003871Rjl2By&id=1086161072877&clicktitle=%E9%97%A8%E5%B0%BC%E3%80%8C%E5%8D%B0%C2%B7IN%E3%80%8D2026%E6%BC%94%E5%94%B1%E4%BC%9A%E5%8C%97%E4%BA%AC%E7%AB%99";
  assert.equal(importers.getDamaiItemId(desktopDamaiUrl), "1086161072877");
  assert.equal(importers.getDamaiItemId("https://detail.damai.cn/item.htm?id=1086161072877&spm=test"), "1086161072877");
  assert.equal(importers.getDamaiItemId("https://m.damai.cn/shows/item.html?itemId=1086161072877"), "1086161072877");
  assert.equal(importers.getDamaiLinkTitle(desktopDamaiUrl), "门尼「印·IN」2026演唱会北京站");
  const desktopFallback = importers.parseDamaiReaderText("Title: 大麦网", desktopDamaiUrl);
  assert.equal(desktopFallback.title, "门尼「印·IN」2026演唱会北京站");
  assert.equal(desktopFallback.city, "北京");
  assert.deepEqual(desktopFallback.artists, ["门尼"]);
  assert.equal(desktopFallback.date, "", "An unreadable page must not invent today's show date");
  assert.equal(desktopFallback.importConfidence, 0.55);

  const verifiedSchedule = posterRegistry.knownDamaiEventFacts("1086161072877");
  assert.equal(verifiedSchedule.date, "2026-11-14");
  assert.equal(verifiedSchedule.time, "19:00");
  assert.equal(verifiedSchedule.city, "北京");
  assert.equal(verifiedSchedule.venue, "国家体育馆");
  assert.equal(posterRegistry.knownDamaiEventFacts("9999999999999"), null);

  const eventPageExcerpt = [
    "总票代 【北京】门尼「印·IN」2026演唱会北京站",
    "时间：2026.11.14 周六 19:00",
    "场馆：北京市 | 国家体育馆",
  ].join("\n");
  const pageTextParsed = importers.parseDamaiReaderText(eventPageExcerpt, desktopDamaiUrl);
  assert.equal(pageTextParsed.date, "2026-11-14");
  assert.equal(pageTextParsed.time, "19:00");
  assert.equal(pageTextParsed.city, "北京");
  assert.equal(pageTextParsed.venue, "国家体育馆");

  const originalNetworkFetch = globalThis.fetch;
  const originalBrowserWindow = globalThis.window;
  try {
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.fetch = async () => { throw new Error("Reader blocked by network/CORS"); };
    const noReader = await importers.fetchDamaiDraft(desktopDamaiUrl);
    assert.equal(noReader.title, "门尼「印·IN」2026演唱会北京站");
    assert.equal(noReader.date, "2026-11-14");
    assert.equal(noReader.time, "19:00");
    assert.equal(noReader.city, "北京");
    assert.equal(noReader.venue, "国家体育馆");
    assert.equal(noReader.address, "北京市朝阳区天辰东路9号");
    assert.equal(noReader.importConfidence, 0.92);
    assert.equal(noReader.status, "planned");
    const pastedWithUrl = await importers.createDraftsFromText(desktopDamaiUrl + "\n" + eventPageExcerpt);
    assert.equal(pastedWithUrl.length, 1);
    assert.equal(pastedWithUrl[0].date, "2026-11-14");
    assert.equal(pastedWithUrl[0].time, "19:00");
    assert.equal(pastedWithUrl[0].venue, "国家体育馆");
  } finally {
    globalThis.fetch = originalNetworkFetch;
    if (originalBrowserWindow === undefined) delete globalThis.window;
    else globalThis.window = originalBrowserWindow;
  }

  const mediaFixture = JSON.stringify({
    itemBase: {
      itemName: "【北京】门尼「印·IN」2026演唱会北京站",
      showTime: "2026.11.14 周六 19:00",
      itemPic: "https://img.alicdn.com/bao/uploaded/https://img.alicdn.com/imgextra/i4/2251059038/O1CN013e7OlJfymqG24P4m_!!2251059038.jpg_q60.jpg_.webp",
      seatImg: "https://img.alicdn.com/imgextra/i4/2251059038/O1CN01nNb6lnFHoeE2b8Lb_!!2251059038.jpg",
      seatImages: ["https://img.alicdn.com/imgextra/i4/2251059038/O1CN01nNb6lnFHoeE2b8Lb_!!2251059038.jpg"],
    },
  });
  const mediaDraft = importers.parseDamaiReaderText(mediaFixture, desktopDamaiUrl);
  assert.equal(mediaDraft.posterUrl, "https://img.alicdn.com/bao/uploaded/https://img.alicdn.com/imgextra/i4/2251059038/O1CN013e7OlJfymqG24P4m_!!2251059038.jpg_q60.jpg_.webp");
  assert.equal(mediaDraft.seatMapUrl, "https://img.alicdn.com/imgextra/i4/2251059038/O1CN01nNb6lnFHoeE2b8Lb_!!2251059038.jpg");
  assert.equal(mediaDraft.date, "2026-11-14");
  assert.equal(mediaDraft.time, "19:00");
  assert.equal(posterRegistry.knownDamaiMedia("1086161072877").posterUrl, mediaDraft.posterUrl);
  assert.equal(posterRegistry.knownDamaiMedia("1086161072877").seatMapUrl, mediaDraft.seatMapUrl);
  // A page may contain different picture URLs: verified event assets take priority.
  const misleadingPage = JSON.stringify({
    itemBase: {
      itemName: "【北京】门尼「印·IN」2026演唱会北京站",
      itemPic: "https://img.alicdn.com/imgextra/i4/example/unrelated-poster.jpg",
      seatImg: "https://img.alicdn.com/imgextra/i4/example/unrelated-seat.jpg",
    },
  });
  const fetchResponse = globalThis.fetch;
  const originalSetTimeout = globalThis.window;
  try {
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.fetch = async () => ({ ok: true, text: async () => misleadingPage });
    const resolved = await importers.fetchDamaiDraft(desktopDamaiUrl);
    assert.equal(resolved.posterUrl, posterRegistry.knownDamaiMedia("1086161072877").posterUrl);
    assert.equal(resolved.seatMapUrl, posterRegistry.knownDamaiMedia("1086161072877").seatMapUrl);
  } finally {
    globalThis.fetch = fetchResponse;
    if (originalSetTimeout === undefined) delete globalThis.window;
    else globalThis.window = originalSetTimeout;
  }


  const damaiFixture = [
    "Title: 【北京】汪苏泷2026「明日世界」演唱会-北京站【网上订票】- 大麦网",
    "![service](https://gw.alicdn.com/imgextra/service-45-45.png)",
    JSON.stringify({
      priceRange: "¥380 - ¥1680",
      venue: { venueName: "国家体育场-鸟巢", venueAddr: "北京市朝阳区国家体育场", venueCityName: "北京市" },
      itemBase: {
        showTime: "2026.08.14-08.30 18:30",
        itemName: "【北京】汪苏泷2026「明日世界」演唱会-北京站【网上订票】- 大麦网",
        itemPic: "https://img.alicdn.com/bao/uploaded/wang-beijing-poster.jpg",
        seatMapUrl: "https://img.alicdn.com/bao/uploaded/wang-beijing-seat-map.jpg",
      },
    }),
  ].join("\n");
  const damaiDraft = importers.parseDamaiReaderText(damaiFixture, "https://m.damai.cn/shows/item.html?itemId=1060966698015");
  assert.equal(damaiDraft.title, "【北京】汪苏泷2026「明日世界」演唱会-北京站");
  assert.equal(damaiDraft.date, "2026-08-14");
  assert.equal(damaiDraft.time, "18:30");
  assert.equal(damaiDraft.city, "北京");
  assert.equal(damaiDraft.venue, "国家体育场-鸟巢");
  assert.equal(damaiDraft.artists?.[0], "汪苏泷");
  assert.equal(damaiDraft.posterUrl, "https://img.alicdn.com/bao/uploaded/wang-beijing-poster.jpg");
  assert.equal(damaiDraft.seatMapUrl, "https://img.alicdn.com/bao/uploaded/wang-beijing-seat-map.jpg");
  assert.equal(damaiDraft.publicPriceRange, "¥380 - ¥1680");

  assert.match(posterRegistry.knownDamaiMedia("1060966698015").posterUrl, /pRGMtzBCAN_/);
  assert.match(posterRegistry.knownDamaiMedia("1064771079264").posterUrl, /Yxe44itf5e_/);
  assert.match(posterRegistry.knownDamaiMedia("1064771079264").seatMapUrl, /inews\.gtimg\.com/);
  assert.equal(posterRegistry.knownDamaiMedia("9999999999999").posterUrl, "");

  const baseRecord = {
    schemaVersion: 2,
    id: "record-1",
    title: "现场记录",
    category: "concert",
    status: "watched",
    recordState: "normal",
    date: "2026-06-18",
    city: "洛阳",
    venue: "体育馆",
    artists: ["歌手"],
    lineup: [{ name: "歌手", role: "artist" }],
    price: 680,
    companions: [],
    tags: [],
    setlist: [],
    sourceChannel: "official",
    media: [{ id: "media-1", recordId: "record-1", kind: "poster", src: "data:image/jpeg;base64,abc", source: "local", createdAt: "2026-06-18T00:00:00.000Z", updatedAt: "2026-06-18T00:00:00.000Z" }],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  };

  const textOnly = syncModel.withoutLocalMedia(baseRecord);
  assert.equal(textOnly.media.length, 0);
  const normalizedUnsafe = storage.normalizeRecord({
    ...baseRecord,
    sourceUrl: "javascript:alert(1)",
    media: [{ ...baseRecord.media[0], src: "data:text/html;base64,PHNjcmlwdD4=" }],
  });
  assert.equal(normalizedUnsafe.sourceUrl, undefined);
  assert.equal(normalizedUnsafe.media[0].src, "");

  const cloudRecord = { ...textOnly, title: "云端新标题", updatedAt: "2026-06-20T00:00:00.000Z" };
  const merged = syncModel.mergeTextBackup([baseRecord], [cloudRecord]);
  assert.equal(merged[0].title, "云端新标题");
  assert.equal(merged[0].media[0].id, "media-1");

  const trashed = { ...cloudRecord, deletedAt: "2026-06-20T01:00:00.000Z", updatedAt: "2026-06-20T01:00:00.000Z" };
  assert.equal(syncModel.mergeTextBackup([baseRecord], [trashed])[0].deletedAt, trashed.deletedAt);

  await assert.rejects(
    () => supabase.pushRecordsToSupabase({
      ...domain.defaultSettings,
      onboardingComplete: true,
      storageMode: "supabase",
      account: { username: "qi2026", nickname: "Qi", avatarUrl: "", recoveryEmail: "" },
      supabase: { url: "https://example.supabase.co", anonKey: "anon", mediaBucket: "echo-media", syncMedia: false, ownerKey: "" },
    }, [baseRecord]),
    /请先连接个人云端/,
  );

  assert.match(
    supabase.friendlySupabaseErrorMessage({ name: "AuthSessionMissingError", message: "Auth session missing!" }),
    /请先登录现场记账号/,
  );
  assert.match(
    supabase.friendlySupabaseErrorMessage({ message: "email rate limit exceeded" }),
    /账号邮件请求过于频繁/,
  );

  const appEntry = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const appRoot = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");
  const appController = await readFile(new URL("../src/appController.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const access = await readFile(new URL("../src/access.tsx", import.meta.url), "utf8");
  const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
  const archiveBannerCss = await readFile(new URL("../src/archiveBanner.css", import.meta.url), "utf8");
  const posterFramesCss = await readFile(new URL("../src/posterFrames.css", import.meta.url), "utf8");
  const archivePolishCss = await readFile(new URL("../src/archivePolish.css", import.meta.url), "utf8");
  const brand = await readFile(new URL("../src/brand.tsx", import.meta.url), "utf8");
  const brandCss = await readFile(new URL("../src/brand.css", import.meta.url), "utf8");
  const experience = await readFile(new URL("../src/experience.tsx", import.meta.url), "utf8");
  const experienceCss = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");
  const shareStudio = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");
  const shareStudioCss = await readFile(new URL("../src/shareStudio.css", import.meta.url), "utf8");
  const mediaCache = await readFile(new URL("../src/mediaCache.ts", import.meta.url), "utf8");
  const syncConflictDialog = await readFile(new URL("../src/syncConflictDialog.tsx", import.meta.url), "utf8");
  const overlaysCss = await readFile(new URL("../src/overlays.css", import.meta.url), "utf8");
  const supabaseSource = await readFile(new URL("../src/supabase.ts", import.meta.url), "utf8");
  const emailLoginMigration = await readFile(new URL("../supabase/migrations/012_email_login_identifier.sql", import.meta.url), "utf8");

  assert.equal(appEntry.trim(), 'export { default } from "./AppRoot";');
  assert.match(main, /<ExperienceThemeProvider>[\s\S]*<AccessGate>/);
  assert.match(main, /archive\.css[\s\S]*archiveBanner\.css[\s\S]*posterFrames\.css[\s\S]*brand\.css/);
  assert.match(appRoot, /<ExperienceShell/);
  assert.doesNotMatch(appRoot, /className="rail"|className="hero"/);
  assert.match(access, /mode === "signed-out"/);
  assert.match(access, /先看看示例/);
  assert.match(access, /用户名 \/ 邮箱/);
  assert.match(access, /resolveLoginUsername/);
  assert.match(emailLoginMigration, /echo_resolve_login_username/);
  assert.match(emailLoginMigration, /recovery_email/);
  assert.match(appController, /guestDemoRecords/);
  assert.match(appController, /Local-first hydration/);
  assert.match(appController, /setRecordState\(loadedRecords\)[\s\S]*syncAfterLogin/);
  assert.match(appController, /if \(isGuest\)/);
  assert.match(appController, /isGuest \? nextRecord : await saveRecord/);
  assert.match(archive, /value: "showcase"/);
  assert.match(archive, /制作分享图/);
  assert.match(archive, /archive-highlight-card/);
  assert.doesNotMatch(archive, /Compact archive masthead v2/);
  assert.match(archiveBannerCss, /aspect-ratio:\s*4 \/ 5/);
  assert.match(archiveBannerCss, /object-fit:\s*contain/);
  assert.match(posterFramesCss, /--poster-frame-ratio:\s*4 \/ 5/);
  assert.match(posterFramesCss, /object-fit:\s*cover/);
  assert.match(main, /posterFrames\.css[\s\S]*archivePolish\.css[\s\S]*brand\.css/);
  assert.match(archive, /archive-card-artist/);
  assert.match(archive, /archive-ticket-line/);
  assert.match(archive, /archive-list-ticket/);
  assert.match(archivePolishCss, /\.archive-card-artist/);
  assert.match(archivePolishCss, /\.archive-ticket-line/);
  assert.match(archivePolishCss, /\.archive-calendar button/);
  assert.match(archivePolishCss, /\.archive-timeline section > \.archive-card-artist/);
  assert.match(brand, /BrandLockup/);
  assert.match(brand, /现场记/);
  assert.match(brand, /Live Memory/);
  assert.match(brandCss, /experience-brand-mark/);
  assert.match(shareStudio, /ScopeMode/);
  assert.match(shareStudio, /selectedIds/);
  assert.match(shareStudio, /Set<EventCategory>/);
  assert.match(shareStudio, /date-desc/);
  assert.match(shareStudio, /ItemLimit = 12 \| 20 \| 30 \| "all"/);
  assert.match(shareStudio, /"landscape-4-3"/);
  assert.match(shareStudio, /"landscape-16-9"/);
  assert.match(shareStudio, /"portrait-3-4"/);
  assert.match(shareStudio, /"portrait-9-16"/);
  assert.match(shareStudio, /ShareLayout = "wall" \| "tickets" \| "timeline" \| "magazine" \| "cities"/);
  assert.match(shareStudioCss, /share-layout-canvas/);
  assert.match(shareStudioCss, /share-amap-panel/);
  assert.match(shareStudio, /loadAmap/);
  assert.match(shareStudio, /AMap\.Geocoder|Geocoder/);
  assert.match(archive, /mapSettings=\{settings\.map\}/);
  assert.match(shareStudioCss, /share-preview-toolbar/);
  assert.match(shareStudioCss, /object-fit:\s*cover/);
  assert.match(shareStudio, /ResizeObserver/);
  assert.match(shareStudio, /recordPosterRatio/);
  assert.match(shareStudio, /drawCover/);
  assert.doesNotMatch(shareStudio, /非地图示意|cityCoordinateFallbacks|function cityCoordinate/);
  assert.match(shareStudio, /function buildWallFillSlots/);
  assert.match(shareStudio, /function buildWeightedMosaic/);
  assert.match(archive, /"poster"[\s\S]*"wallet"[\s\S]*"ticket"[\s\S]*"timeline"[\s\S]*"calendar"[\s\S]*"venue"[\s\S]*"price"[\s\S]*"summary"[\s\S]*"list"/);
  assert.match(experience, /https:\/\/github\.com\/Qi-i\/live-memory/);
  assert.match(experience, /experience-mobile-nav/);
  assert.match(experienceCss, /@media \(max-width: 920px\)/);
  assert.match(experienceCss, /is-share-mode/);
  assert.match(mediaCache, /caches\.open\(currentCacheName\(\)\)/);
  assert.match(mediaCache, /CACHE_PREFIX = "live-memory-media-v3"/);
  assert.match(mediaCache, /storage:\$\{asset\.storagePath\}/);
  assert.match(mediaCache, /MEDIA_CACHE_SCOPE_EVENT/);
  assert.match(mediaCache, /persistInlineSource/);
  assert.match(mediaCache, /peekResolvedMediaSource/);
  assert.match(mediaCache, /export async function preloadPrimaryRecordMedia/);
  assert.doesNotMatch(mediaCache, /storage:\$\{asset\.storagePath\}:\$\{asset\.updatedAt/);
  assert.match(appController, /preloadRecordMedia/);
  assert.match(supabaseSource, /recordsSemanticallyEqual\(local, cloud, false\)[\s\S]*mergeMediaState\(local, cloud\)[\s\S]*continue;/);
  assert.match(supabaseSource, /diffFields:\s*syncConflictDiffFields\(local, cloud\)/);
  assert.match(syncConflictDialog, /实际差异：/);
  assert.match(syncConflictDialog, /时间戳完全一致/);
  assert.match(overlaysCss, /\.conflict-record-copy-v2/);
  assert.match(appController, /CustomEvent<\{ storagePath\?: string \}>/);
  assert.doesNotMatch(appController, /window\.addEventListener\("focus"/);
  assert.doesNotMatch(appController, /document\.addEventListener\("visibilitychange", onVisible\)/);
  assert.match(appController, /setInterval\(retryPersonalCloud,\s*60_000\)/);
  assert.match(mediaCache, /PageTransitionEvent/);
  assert.match(mediaCache, /persisted\) return/);
  assert.match(archive, /resolveMarkerPosterSources/);
  assert.match(archive, /placeGroupMapFingerprint/);
  assert.match(archive, /loadMediaImage\(media\)/, "Map marker posters must be decoded through the shared media cache before marker mounting");
  assert.doesNotMatch(archive, /map\.setFitView/);
  assert.match(archive, /resizeEnable:\s*false/);
  assert.match(shareStudio, /loadMediaImage\(primaryMedia\(record\)\)/);
  assert.match(shareStudio, /preloadPrimaryRecordMedia\(selectedRecords\)/);
  assert.match(shareStudio, /SHARE_POSTER_MAX_FRAME_ASPECT\s*=\s*0\.86/);
  assert.match(shareStudio, /fitPosterRowRatios/);
  assert.match(shareStudio, /is-poster-preserved/);
  assert.match(shareStudio, /shareCityPositionCache/);
  assert.match(shareStudio, /shareCityFingerprint/);
  assert.match(shareStudioCss, /share-poster-frame\.is-preserved[\s\S]*object-fit:\s*contain/);
  assert.match(shareStudio, /正在从统一图片缓存准备海报/);

  console.log("Core and architecture verification passed: account rules, username-or-email login compatibility, safe URL cleanup, in-memory example mode, modular shell, archive view registry, complete poster frames, fitted preview scaling, category-aware newest-first sharing, four geometry-driven layouts, reusable branding, responsive navigation, cached media, GitHub entry, cloud upload guard, and clear auth errors.");
} finally {
  await server.close();
}
