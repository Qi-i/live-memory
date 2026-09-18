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
  const supabase = await server.ssrLoadModule("/src/supabase.ts");

  const base = {
    schemaVersion: 2,
    id: "record-integrity",
    title: "数据一致性测试",
    category: "concert",
    status: "watched",
    recordState: "normal",
    date: "2026-09-18",
    city: "北京",
    venue: "测试场馆",
    artists: ["测试歌手"],
    lineup: [{ name: "测试歌手", role: "artist" }],
    price: 680,
    companions: [],
    tags: [],
    setlist: [],
    sourceChannel: "official",
    media: [],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
  };

  const cloudPoster = {
    id: "poster-old",
    recordId: base.id,
    kind: "poster",
    src: "https://example.supabase.co/storage/poster-old.jpg",
    storagePath: "owner/record-integrity/poster-old.jpg",
    source: "supabase",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T09:00:00.000Z",
  };

  const deletedLocally = storage.normalizeRecord({
    ...base,
    updatedAt: "2026-09-18T11:00:00.000Z",
    media: [cloudPoster],
    mediaTombstones: [{
      id: cloudPoster.id,
      storagePath: cloudPoster.storagePath,
      deletedAt: "2026-09-18T10:30:00.000Z",
    }],
  });
  assert.equal(deletedLocally.media.length, 0, "A media tombstone must suppress an older asset");

  const personalCloud = storage.normalizeRecord({
    ...base,
    updatedAt: "2026-09-18T10:00:00.000Z",
    media: [cloudPoster],
  });
  const mergedAfterDelete = supabase.mergePersonalCloudMedia([deletedLocally], [personalCloud]);
  assert.equal(mergedAfterDelete[0].media.length, 0, "An older cloud asset must not resurrect after local deletion");
  assert.equal(mergedAfterDelete[0].mediaTombstones?.[0]?.id, cloudPoster.id);

  const accountTextOnly = storage.normalizeRecord({
    ...base,
    updatedAt: "2026-09-18T12:00:00.000Z",
    title: "账号文字较新",
    media: [],
  });
  const restoredMedia = supabase.mergePersonalCloudMedia([accountTextOnly], [personalCloud]);
  assert.equal(restoredMedia[0].title, "账号文字较新");
  assert.equal(restoredMedia[0].media[0].storagePath, cloudPoster.storagePath, "Text-only account backup must not erase personal-cloud media");

  const newerCloudPoster = { ...cloudPoster, src: "https://example.supabase.co/storage/new.jpg", updatedAt: "2026-09-18T13:00:00.000Z" };
  const mergedLatestAsset = supabase.mergePersonalCloudMedia(
    [{ ...personalCloud, media: [cloudPoster] }],
    [{ ...personalCloud, media: [newerCloudPoster] }],
  );
  assert.equal(mergedLatestAsset[0].media[0].src, newerCloudPoster.src, "Newest asset revision should win");

  const personalConflict = {
    recordId: base.id,
    title: base.title,
    localUpdatedAt: "2026-09-18T12:00:00.000Z",
    cloudUpdatedAt: "2026-09-18T13:00:00.000Z",
    localRecord: storage.normalizeRecord({ ...base, media: [{ ...cloudPoster, id: "local-poster", storagePath: "owner/record-integrity/local.jpg" }] }),
    cloudRecord: storage.normalizeRecord({ ...base, media: [{ ...newerCloudPoster, id: "cloud-poster", storagePath: "owner/record-integrity/cloud.jpg" }] }),
    source: "personal",
  };
  const chosePersonalCloud = await supabase.resolveSyncConflict(domain.defaultSettings, personalConflict, "cloud");
  assert.equal(chosePersonalCloud.media[0].id, "cloud-poster", "Choosing personal cloud must actually keep cloud media");

  const accountConflict = {
    ...personalConflict,
    source: "account",
    cloudRecord: storage.normalizeRecord({ ...base, title: "账号文字版本", media: [] }),
  };
  const choseAccountCloud = await supabase.resolveSyncConflict(domain.defaultSettings, accountConflict, "cloud");
  assert.equal(choseAccountCloud.title, "账号文字版本");
  assert.equal(choseAccountCloud.media[0].id, "local-poster", "Choosing account text backup must preserve local media");

  const storageSource = await readFile(new URL("../src/storage.ts", import.meta.url), "utf8");
  const controllerSource = await readFile(new URL("../src/appController.ts", import.meta.url), "utf8");
  const supabaseSource = await readFile(new URL("../src/supabase.ts", import.meta.url), "utf8");
  const overlaysSource = await readFile(new URL("../src/overlays.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(storageSource, /migrated\.length \? migrated : seedRecords/, "Signed-in empty stores must not receive demo records");
  assert.doesNotMatch(storageSource, /import \{ seedRecords \} from "\.\/seeds"/, "Seed data must stay out of persistent signed-in storage");
  assert.match(overlaysSource, /mediaTombstonesAfterRemoval/, "Editor removals must create media tombstones");
  assert.match(supabaseSource, /applyMediaTombstones/, "Cloud sync must apply media tombstones");
  assert.doesNotMatch(supabaseSource, /catch \{\s*return asset;\s*\}/, "Media upload failures must not be silently converted into success");
  assert.match(supabaseSource, /throw new Error\("个人云端尚未恢复，已取消永久删除/, "Permanent cloud deletion must fail closed without an owner key");
  assert.doesNotMatch(controllerSource, /purgeTextBackupFromAccount\(settings, record\.id\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(controllerSource, /purgeRecordFromSupabase\(settings, record\.id\)\.catch\(\(\) => undefined\)/);
  assert.match(controllerSource, /永久删除失败，本机记录已保留/, "Local copy must remain when a cloud purge fails");

  console.log("Data-integrity contracts passed: no seed pollution, deletion tombstones, no media resurrection, fail-closed uploads/deletes, and correct conflict media semantics.");
} finally {
  await server.close();
}
