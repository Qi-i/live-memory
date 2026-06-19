import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const domain = await server.ssrLoadModule("/src/domain.ts");
  const syncModel = await server.ssrLoadModule("/src/syncModel.ts");

  assert.equal(domain.validateUsername("Qi2026"), "qi2026");
  assert.throws(() => domain.validateUsername("abc"));
  assert.throws(() => domain.validateUsername("qi_name"));
  assert.equal(domain.validatePassword("12345678"), "12345678");
  assert.throws(() => domain.validatePassword("1234567"));
  assert.equal(domain.validateRecoveryEmail("qi@example.com"), "qi@example.com");
  assert.throws(() => domain.validateRecoveryEmail("qi.example.com"));

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

  const cloudRecord = { ...textOnly, title: "云端新标题", updatedAt: "2026-06-20T00:00:00.000Z" };
  const merged = syncModel.mergeTextBackup([baseRecord], [cloudRecord]);
  assert.equal(merged[0].title, "云端新标题");
  assert.equal(merged[0].media[0].id, "media-1");

  const trashed = { ...cloudRecord, deletedAt: "2026-06-20T01:00:00.000Z", updatedAt: "2026-06-20T01:00:00.000Z" };
  assert.equal(syncModel.mergeTextBackup([baseRecord], [trashed])[0].deletedAt, trashed.deletedAt);

  console.log("Core verification passed: account rules, text-only backup, local media merge, recycle state.");
} finally {
  await server.close();
}
