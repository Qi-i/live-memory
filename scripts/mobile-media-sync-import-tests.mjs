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
  const importers = await server.ssrLoadModule("/src/importers.ts");
  const supabase = await server.ssrLoadModule("/src/supabase.ts");

  assert.equal(domain.sourceLabels.piaoxingqiu, "票星球");
  assert.equal(domain.normalizeSource("piaoxingqiu"), "piaoxingqiu");
  assert.equal(importers.detectTicketingPlatform("https://m.damai.cn/shows/item.html?itemId=123"), "damai");
  assert.equal(importers.detectTicketingPlatform("https://m.livelab.com.cn/performance/abc"), "fenwandao");
  assert.equal(importers.detectTicketingPlatform("https://m.piaoxingqiu.com/content/67d107f499c2e800015fdcc9"), "piaoxingqiu");

  const pxq = importers.parseTicketingReaderText([
    "Title: 【北京】测试歌手 2026 巡回演唱会",
    "演出时间：2026-10-03 19:30",
    "演出场馆：国家体育馆",
    "票价：380 / 680 / 980",
    "![演出海报](https://cdn.example.com/poster-vertical.jpg)",
  ].join("\n"), "https://m.piaoxingqiu.com/content/example", "piaoxingqiu");
  assert.equal(pxq.sourceChannel, "piaoxingqiu");
  assert.equal(pxq.date, "2026-10-03");
  assert.equal(pxq.time, "19:30");
  assert.equal(pxq.venue, "国家体育馆");
  assert.equal(pxq.posterUrl, "https://cdn.example.com/poster-vertical.jpg");

  const baseRecord = {
    schemaVersion: 2,
    id: "r1",
    title: "同一场演出",
    category: "concert",
    status: "watched",
    recordState: "normal",
    date: "2026-09-01",
    city: "北京",
    venue: "场馆",
    artists: ["歌手"],
    lineup: [{ name: "歌手", role: "artist" }],
    price: 680,
    companions: [],
    tags: [],
    setlist: [],
    sourceChannel: "damai",
    media: [],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
    syncedAt: "2026-09-14T12:00:00.000Z",
  };
  const sameCloud = { ...baseRecord, syncedAt: undefined };
  assert.equal(supabase.recordsSemanticallyEqual(baseRecord, sameCloud, false), true);
  assert.equal(supabase.recordsSemanticallyEqual(baseRecord, { ...sameCloud, venue: "另一个场馆" }, false), false);

  const localWithUploadedPoster = {
    ...baseRecord,
    media: [{
      id: "media-1",
      recordId: "r1",
      kind: "poster",
      src: "data:image/jpeg;base64,local-preview",
      storagePath: "owner/r1/media-1.jpg",
      source: "local",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    }],
  };
  const cloudWithSignedPoster = {
    ...sameCloud,
    media: [{
      id: "media-1",
      recordId: "r1",
      kind: "poster",
      src: "https://example.supabase.co/storage/v1/object/sign/echo-media/owner/r1/media-1.jpg?token=rotating",
      storagePath: "owner/r1/media-1.jpg",
      source: "supabase",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    }],
  };
  assert.equal(supabase.recordsSemanticallyEqual(localWithUploadedPoster, cloudWithSignedPoster, true), true);

  const overlays = await readFile(new URL("../src/overlays.tsx", import.meta.url), "utf8");
  const overlayCss = await readFile(new URL("../src/overlays.css", import.meta.url), "utf8");
  const media = await readFile(new URL("../src/media.ts", import.meta.url), "utf8");
  const appController = await readFile(new URL("../src/appController.ts", import.meta.url), "utf8");
  const settingsPage = await readFile(new URL("../src/settingsPage.tsx", import.meta.url), "utf8");

  assert.match(overlays, /media-editor-card-v2/);
  assert.match(overlays, /正在处理/);
  assert.match(overlays, /截图识别/);
  assert.match(overlays, /recognizeTicketScreenshot/);
  assert.match(overlayCss, /\.media-editor-card-v2/);
  assert.match(media, /createImageBitmap/);
  assert.match(media, /toBlob/);
  assert.match(appController, /autoSyncFingerprint/);
  assert.doesNotMatch(settingsPage, />上传当前档案</);

  console.log("Mobile media editor, automatic cloud sync, conflict equality, multi-platform ticket import, and screenshot OCR contracts passed.");
} finally {
  await server.close();
}
