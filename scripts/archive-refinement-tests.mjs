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
  const base = {
    schemaVersion: 2,
    id: "r1",
    title: "测试演出",
    category: "concert",
    status: "planned",
    recordState: "normal",
    date: "2026-09-16",
    time: "19:30",
    city: "北京",
    venue: "测试场馆",
    artists: ["歌手A"],
    lineup: [{ name: "歌手A", role: "artist" }],
    companions: [], tags: [], setlist: [], sourceChannel: "", media: [], favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  assert.equal(domain.effectiveStatus(base, new Date("2026-09-16T19:29:00")), "planned");
  assert.equal(domain.effectiveStatus(base, new Date("2026-09-16T19:30:00")), "planned");
  assert.equal(domain.effectiveStatus(base, new Date("2026-09-16T19:31:00")), "watched");
  assert.equal(domain.effectiveStatus({ ...base, time: "" }, new Date("2026-09-16T22:00:00")), "planned");
  assert.equal(domain.effectiveStatus({ ...base, time: "" }, new Date("2026-09-17T00:01:00")), "watched");
  assert.equal(domain.effectiveStatus({ ...base, status: "wish", date: "2026-09-01" }, new Date("2026-09-16T12:00:00")), "wish");

  const archive = await readFile(new URL("../src/archive.tsx", import.meta.url), "utf8");
  const bannerCss = await readFile(new URL("../src/archiveBanner.css", import.meta.url), "utf8");
  const appRoot = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");
  const stats = await readFile(new URL("../src/statsPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(archive, /archive-result-strip/);
  assert.match(archive, /pickArchiveHighlights/);
  assert.match(archive, /usedArtists/);
  assert.match(archive, /artists\.some\(\(artist\) => usedArtists\.has\(artist\)\)/);
  assert.match(archive, /effectiveStatus\(record\)/);
  assert.match(appRoot, /effectiveStatus\(record\)/);
  assert.match(stats, /effectiveStatus\(record\)/);
  assert.match(bannerCss, /archive-highlight-card-5/);
  assert.match(bannerCss, /object-fit:\s*cover/);
  assert.match(bannerCss, /archive-ticket > div img[\s\S]*object-fit:\s*cover/);

  console.log("Archive status, masthead density, duplicate-artist highlights, result-strip removal, and ticket-cover contracts passed.");
} finally {
  await server.close();
}
