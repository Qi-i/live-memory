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
  const actions = await server.ssrLoadModule("/src/recordActions.ts");
  const base = {
    schemaVersion: 2,
    id: "record-original",
    title: "同一巡演 北京站",
    category: "concert",
    status: "watched",
    recordState: "normal",
    date: "2026-09-26",
    time: "19:30",
    city: "北京",
    venue: "工人体育场",
    artists: ["测试歌手"],
    lineup: [{ name: "测试歌手", role: "artist" }],
    price: 699,
    publicPriceRange: "399 / 699 / 999",
    seat: "A1区 10排 8号",
    companions: ["朋友A"],
    tags: ["巡演"],
    note: "第一场",
    setlist: ["歌曲A"],
    sourceChannel: "damai",
    sourceUrl: "https://m.damai.cn/example",
    media: [
      { id: "poster-1", recordId: "record-original", kind: "poster", src: "https://cdn.example.com/poster.jpg", title: "海报", source: "external", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "ticket-1", recordId: "record-original", kind: "ticket", src: "data:image/jpeg;base64,ticket", source: "local", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z" },
      { id: "seat-1", recordId: "record-original", kind: "seatMap", src: "data:image/jpeg;base64,seat", source: "local", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z" },
      { id: "live-1", recordId: "record-original", kind: "livePhoto", src: "data:image/jpeg;base64,live", source: "local", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z" },
    ],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-26T23:00:00.000Z",
    syncedAt: "2026-09-27T00:00:00.000Z",
  };
  const sourceSnapshot = structuredClone(base);

  const duplicate = actions.duplicateRecordForNextShow(base, new Date("2026-09-27T08:00:00.000Z"));
  assert.notEqual(duplicate.id, base.id);
  assert.equal(duplicate.date, "2026-09-27");
  assert.equal(duplicate.time, "19:30");
  assert.equal(duplicate.price, 699);
  assert.equal(duplicate.publicPriceRange, "399 / 699 / 999");
  assert.equal(duplicate.seat, undefined);
  assert.deepEqual(duplicate.companions, []);
  assert.deepEqual(duplicate.setlist, []);
  assert.equal(duplicate.note, undefined);
  assert.equal(duplicate.status, "planned");
  assert.equal(duplicate.recordState, "normal");
  assert.equal(duplicate.syncedAt, undefined);
  assert.equal(duplicate.deletedAt, undefined);
  assert.deepEqual(duplicate.media.map((item) => item.kind), ["poster"]);
  assert.notEqual(duplicate.media[0].id, base.media[0].id);
  assert.notEqual(duplicate.media[0], base.media[0]);
  assert.equal(duplicate.media[0].recordId, duplicate.id);
  assert.notEqual(duplicate.artists, base.artists);
  assert.deepEqual(base, sourceSnapshot);

  const monthBoundary = actions.duplicateRecordForNextShow({ ...base, date: "2026-09-30" }, new Date("2026-09-30T12:00:00.000Z"));
  assert.equal(monthBoundary.date, "2026-10-01");

  const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
  const appRoot = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/archiveContextMenu.css", import.meta.url), "utf8");

  assert.match(archive, /addEventListener\("contextmenu"/);
  assert.match(archive, /data-archive-record-id/);
  assert.match(archive, /复制为新场次/);
  assert.match(archive, /archive-context-menu/);
  assert.match(appRoot, /duplicateRecordForNextShow/);
  assert.match(appRoot, /onDuplicate/);
  assert.match(appRoot, /onDelete/);
  assert.match(css, /\.archive-context-menu/);

  console.log("Archive card context menu and next-show duplication contracts passed.");
} finally {
  await server.close();
}
