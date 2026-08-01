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

  assert.equal(domain.validateUsername("Qi2026"), "qi2026");
  assert.throws(() => domain.validateUsername("abc"));
  assert.throws(() => domain.validateUsername("qi_name"));
  assert.equal(domain.validatePassword("12345678"), "12345678");
  assert.throws(() => domain.validatePassword("1234567"));
  assert.equal(domain.validateRecoveryEmail("qi@example.com"), "qi@example.com");
  assert.throws(() => domain.validateRecoveryEmail("qi.example.com"));
  assert.equal(domain.normalizeExternalUrl("javascript:alert(1)"), "");
  assert.equal(domain.normalizeExternalUrl("https://m.damai.cn/shows/item.html?itemId=1"), "https://m.damai.cn/shows/item.html?itemId=1");

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
  const experience = await readFile(new URL("../src/experience.tsx", import.meta.url), "utf8");
  const experienceCss = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");
  const shareStudio = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");
  const shareStudioCss = await readFile(new URL("../src/shareStudio.css", import.meta.url), "utf8");
  const mediaCache = await readFile(new URL("../src/mediaCache.ts", import.meta.url), "utf8");

  assert.equal(appEntry.trim(), 'export { default } from "./AppRoot";');
  assert.match(main, /<ExperienceThemeProvider>[\s\S]*<AccessGate>/);
  assert.match(main, /archive\.css[\s\S]*archiveBanner\.css/);
  assert.match(appRoot, /<ExperienceShell/);
  assert.doesNotMatch(appRoot, /className="rail"|className="hero"/);
  assert.match(access, /mode === "signed-out"/);
  assert.match(access, /先看看示例/);
  assert.match(appController, /guestDemoRecords/);
  assert.match(appController, /if \(isGuest\)/);
  assert.match(appController, /isGuest \? nextRecord : await saveRecord/);
  assert.match(archive, /value: "showcase"/);
  assert.match(archive, /制作分享图/);
  assert.match(archive, /archive-highlight-card/);
  assert.doesNotMatch(archive, /Compact archive masthead v2/);
  assert.match(archiveBannerCss, /aspect-ratio:\s*2 \/ 3/);
  assert.match(archiveBannerCss, /object-fit:\s*contain/);
  assert.match(shareStudio, /ScopeMode/);
  assert.match(shareStudio, /selectedIds/);
  assert.match(shareStudio, /ItemLimit = 12 \| 20 \| 30 \| "all"/);
  assert.match(shareStudio, /ShareFormat = "landscape" \| "portrait" \| "square" \| "long"/);
  assert.match(shareStudioCss, /share-layout-dense/);
  assert.match(shareStudioCss, /aspect-ratio:\s*2 \/ 3/);
  assert.match(shareStudioCss, /object-fit:\s*contain/);
  assert.match(archive, /"poster"[\s\S]*"wallet"[\s\S]*"ticket"[\s\S]*"timeline"[\s\S]*"calendar"[\s\S]*"venue"[\s\S]*"price"[\s\S]*"summary"[\s\S]*"list"/);
  assert.match(experience, /https:\/\/github\.com\/Qi-i\/live-memory/);
  assert.match(experience, /experience-mobile-nav/);
  assert.match(experienceCss, /@media \(max-width: 920px\)/);
  assert.match(experienceCss, /is-share-mode/);
  assert.match(mediaCache, /caches\.open\(CACHE_NAME\)/);
  assert.match(mediaCache, /storage:\$\{asset\.storagePath\}/);
  assert.match(appController, /preloadRecordMedia/);
  assert.match(appController, /CustomEvent<\{ storagePath\?: string \}>/);
  assert.match(shareStudio, /loadMediaImage\(primaryMedia\(record\)\)/);
  assert.match(shareStudio, /正在准备海报/);

  console.log("Core and architecture verification passed: account rules, safe URL cleanup, in-memory example mode, modular shell, archive view registry, portrait banner, mass share selection, responsive navigation, share image, GitHub entry, cloud upload guard, and clear auth errors.");
} finally {
  await server.close();
}
