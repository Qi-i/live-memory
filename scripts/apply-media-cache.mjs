import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Pattern not found: ${label}`);
  return source.replace(from, to);
}

await patch("src/supabase.ts", (source) => {
  source = replaceOnce(source, `export async function refreshSignedMediaUrls(settings: AppSettings, records: EventRecord[]) {
  if (!settings.supabase.ownerKey || !settings.supabase.syncMedia) return records;
  const client = makeSupabaseClient(settings);
  return Promise.all(records.map(async (record) => {
    const media = await Promise.all(record.media.map((asset) => signMediaIfNeeded(client, asset, mediaBucket(settings))));
    return normalizeRecord({ ...record, media });
  }));
}`, `const SIGNED_MEDIA_TTL_SECONDS = 60 * 60 * 24 * 30;
const SIGNED_MEDIA_RENEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const signedMediaSessionCache = new Map<string, { url: string; expiresAt: number }>();

export interface MediaRefreshOptions {
  force?: boolean;
  storagePath?: string;
}

function signedMediaCacheKey(bucket: string, path: string) {
  return \`${'${bucket}'}:${'${path}'}\`;
}

function decodeJwtPayload(token: string) {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
}

function signedMediaExpiresAt(url: string) {
  if (!url) return 0;
  try {
    const parsed = new URL(url, "https://local.invalid");
    const token = parsed.searchParams.get("token");
    const payload = token ? decodeJwtPayload(token) : null;
    if (payload?.exp) return payload.exp * 1000;
    const expires = Number(parsed.searchParams.get("expires") || parsed.searchParams.get("expires_at"));
    if (Number.isFinite(expires) && expires > 0) return expires > 10_000_000_000 ? expires : expires * 1000;
  } catch {
    return 0;
  }
  return 0;
}

function hasUsableSignedMedia(asset: MediaAsset) {
  if (!asset.storagePath || !asset.src || asset.src.startsWith("data:") || asset.src.startsWith("blob:")) return false;
  return signedMediaExpiresAt(asset.src) > Date.now() + SIGNED_MEDIA_RENEW_WINDOW_MS;
}

export async function refreshSignedMediaUrls(
  settings: AppSettings,
  records: EventRecord[],
  options: MediaRefreshOptions = {},
) {
  if (!settings.supabase.ownerKey || !settings.supabase.syncMedia) return records;
  const client = makeSupabaseClient(settings);
  const bucket = mediaBucket(settings);
  const paths = new Set<string>();

  for (const record of records) {
    for (const asset of record.media) {
      if (!asset.storagePath) continue;
      if (options.storagePath && asset.storagePath !== options.storagePath) continue;
      const key = signedMediaCacheKey(bucket, asset.storagePath);
      if (!options.force && hasUsableSignedMedia(asset)) {
        signedMediaSessionCache.set(key, { url: asset.src, expiresAt: signedMediaExpiresAt(asset.src) });
        continue;
      }
      const cached = signedMediaSessionCache.get(key);
      if (!options.force && cached && cached.expiresAt > Date.now() + SIGNED_MEDIA_RENEW_WINDOW_MS) continue;
      paths.add(asset.storagePath);
    }
  }

  if (paths.size) {
    const signed = await client.storage.from(bucket).createSignedUrls(Array.from(paths), SIGNED_MEDIA_TTL_SECONDS);
    if (signed.error) throw signed.error;
    for (const item of signed.data || []) {
      const path = String(item.path || "");
      const url = String(item.signedUrl || "");
      if (!path || !url) continue;
      signedMediaSessionCache.set(signedMediaCacheKey(bucket, path), {
        url,
        expiresAt: signedMediaExpiresAt(url) || Date.now() + SIGNED_MEDIA_TTL_SECONDS * 1000,
      });
    }
  }

  return records.map((record) => normalizeRecord({
    ...record,
    media: record.media.map((asset) => {
      if (!asset.storagePath) return asset;
      const cached = signedMediaSessionCache.get(signedMediaCacheKey(bucket, asset.storagePath));
      return cached ? { ...asset, src: cached.url, source: "supabase" as const } : asset;
    }),
  }));
}`, "batch signed media refresh");

  source = replaceOnce(source, `async function signMediaIfNeeded(client: SupabaseClient, asset: MediaAsset, bucket: string): Promise<MediaAsset> {
  if (asset.src.startsWith("data:")) return asset;
  if (!asset.storagePath) return asset;
  const signed = await client.storage.from(bucket).createSignedUrl(asset.storagePath, 60 * 60 * 24 * 7);
  if (signed.error || !signed.data?.signedUrl) return asset;
  return { ...asset, src: signed.data.signedUrl, source: "supabase" };
}`, `async function signMediaIfNeeded(client: SupabaseClient, asset: MediaAsset, bucket: string): Promise<MediaAsset> {
  if (asset.src.startsWith("data:") || asset.src.startsWith("blob:")) return asset;
  if (!asset.storagePath) return asset;
  const key = signedMediaCacheKey(bucket, asset.storagePath);
  if (hasUsableSignedMedia(asset)) {
    signedMediaSessionCache.set(key, { url: asset.src, expiresAt: signedMediaExpiresAt(asset.src) });
    return asset;
  }
  const cached = signedMediaSessionCache.get(key);
  if (cached && cached.expiresAt > Date.now() + SIGNED_MEDIA_RENEW_WINDOW_MS) {
    return { ...asset, src: cached.url, source: "supabase" };
  }
  const signed = await client.storage.from(bucket).createSignedUrl(asset.storagePath, SIGNED_MEDIA_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return asset;
  signedMediaSessionCache.set(key, {
    url: signed.data.signedUrl,
    expiresAt: signedMediaExpiresAt(signed.data.signedUrl) || Date.now() + SIGNED_MEDIA_TTL_SECONDS * 1000,
  });
  return { ...asset, src: signed.data.signedUrl, source: "supabase" };
}`, "signed media reuse");

  return source;
});

await patch("src/appController.ts", (source) => {
  source = replaceOnce(source,
    `import { seedRecords } from "./seeds";`,
    `import { seedRecords } from "./seeds";\nimport { preloadRecordMedia } from "./mediaCache";`,
    "media cache import",
  );
  source = replaceOnce(source,
    `      setSettings(guestSettings);\n      lastSyncFingerprint.current = recordFingerprint(demoRecords);`,
    `      setSettings(guestSettings);\n      void preloadRecordMedia(demoRecords);\n      lastSyncFingerprint.current = recordFingerprint(demoRecords);`,
    "guest preload",
  );
  source = replaceOnce(source,
    `        setSettings(nextSettings);\n        lastSyncFingerprint.current = recordFingerprint(nextRecords);`,
    `        setSettings(nextSettings);\n        void preloadRecordMedia(nextRecords);\n        lastSyncFingerprint.current = recordFingerprint(nextRecords);`,
    "account preload",
  );
  source = replaceOnce(source,
    `    async function refresh(force = false) {`,
    `    async function refresh(force = false, storagePath?: string) {`,
    "refresh signature",
  );
  source = replaceOnce(source,
    `        const next = await refreshSignedMediaUrls(settings, snapshot);`,
    `        const next = await refreshSignedMediaUrls(settings, snapshot, { force, storagePath });\n        void preloadRecordMedia(next);`,
    "refresh options",
  );
  source = replaceOnce(source,
    `    void refresh(true);`,
    `    void refresh(false);`,
    "initial refresh",
  );
  source = replaceOnce(source,
    `    const onOnline = () => void refresh(true);\n    const onMediaError = () => void refresh(true);`,
    `    const onOnline = () => void refresh(false);\n    const onMediaError = (event: Event) => {\n      const storagePath = (event as CustomEvent<{ storagePath?: string }>).detail?.storagePath;\n      void refresh(true, storagePath);\n    };`,
    "targeted refresh events",
  );
  return source;
});

await patch("src/archive.tsx", (source) => {
  source = replaceOnce(source,
    `  useMemo,\n  useState,`,
    `  useEffect,\n  useMemo,\n  useState,`,
    "archive useEffect import",
  );
  source = replaceOnce(source,
    `import { ShareStudio, type ShareFormat } from "./shareStudio";`,
    `import { ShareStudio, type ShareFormat } from "./shareStudio";\nimport { useCachedMediaSrc } from "./mediaCache";`,
    "archive cache import",
  );
  source = replaceOnce(source, `function RecordMedia({ media, alt, fallback = "图片待补", onClick }: { media?: MediaAsset; alt?: string; fallback?: string; onClick?: (event: MouseEvent<HTMLImageElement | HTMLSpanElement>) => void }) {
  const [failed, setFailed] = useState(false);
  if (!media?.src || failed) return <span className="record-media-fallback" onClick={onClick}>{media?.storagePath ? "图片正在重新加载" : fallback}</span>;
  return <img src={media.src} alt={alt || ""} loading="lazy" onClick={onClick} onError={() => { setFailed(true); if (media.storagePath) window.dispatchEvent(new Event("live-memory:cloud-media-refresh")); }} />;
}`, `function RecordMedia({ media, alt, fallback = "图片待补", onClick }: { media?: MediaAsset; alt?: string; fallback?: string; onClick?: (event: MouseEvent<HTMLImageElement | HTMLSpanElement>) => void }) {
  const src = useCachedMediaSrc(media);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src, media?.storagePath]);
  if (!src || failed) return <span className="record-media-fallback" onClick={onClick}>{media?.storagePath ? "图片正在载入" : fallback}</span>;
  return <img
    src={src}
    alt={alt || ""}
    loading="lazy"
    decoding="async"
    onClick={onClick}
    onError={() => {
      setFailed(true);
      if (media?.storagePath) {
        window.dispatchEvent(new CustomEvent("live-memory:cloud-media-refresh", { detail: { storagePath: media.storagePath } }));
      }
    }}
  />;
}`, "cached RecordMedia");
  return source;
});

await patch("src/shareStudio.tsx", (source) => {
  source = replaceOnce(source,
    `import { primaryMedia } from "./domain";`,
    `import { primaryMedia } from "./domain";\nimport { loadMediaImage, preloadRecordMedia, useCachedMediaSrc } from "./mediaCache";`,
    "share cache import",
  );
  source = replaceOnce(source,
    `  const [saved, setSaved] = useState(false);\n  const [error, setError] = useState("");`,
    `  const [saved, setSaved] = useState(false);\n  const [preparing, setPreparing] = useState(true);\n  const [error, setError] = useState("");`,
    "share preparing state",
  );
  source = replaceOnce(source,
    `  }, [onClose]);\n\n  async function savePng() {`,
    `  }, [onClose]);\n\n  useEffect(() => {\n    let active = true;\n    setPreparing(true);\n    void preloadRecordMedia(selected).finally(() => {\n      if (active) setPreparing(false);\n    });\n    return () => { active = false; };\n  }, [selected]);\n\n  async function savePng() {`,
    "share preload effect",
  );
  source = replaceOnce(source,
    `      setError("图片生成失败。请等待海报加载完成后再试；无法读取的外部图片会自动改用色块。 ");`,
    `      setError("图片生成失败。请稍后重试；无法跨域读取的外部图片会自动改用色块。");`,
    "share error copy",
  );
  source = replaceOnce(source,
    `        <button className="share-export-button" type="button" disabled={saving || !selected.length} onClick={() => void savePng()}>\n          <Download />{saving ? "正在生成…" : saved ? "已保存到下载目录" : "保存 PNG 图片"}\n        </button>`,
    `        <button className="share-export-button" type="button" disabled={saving || preparing || !selected.length} onClick={() => void savePng()}>\n          <Download />{preparing ? "正在准备海报…" : saving ? "正在生成…" : saved ? "已保存到下载目录" : "保存 PNG 图片"}\n        </button>`,
    "share preparation button",
  );
  source = replaceOnce(source, `function SharePoster({ record }: { record: EventRecord }) {
  const media = primaryMedia(record);
  const style = { "--poster-a": record.colors[0], "--poster-b": record.colors[1] } as CSSProperties;
  if (!media?.src) return <span className="share-poster-fallback" style={style}>{record.title.slice(0, 4)}</span>;
  return <img src={media.src} alt={record.title} crossOrigin="anonymous" />;
}`, `function SharePoster({ record }: { record: EventRecord }) {
  const media = primaryMedia(record);
  const src = useCachedMediaSrc(media);
  const style = { "--poster-a": record.colors[0], "--poster-b": record.colors[1] } as CSSProperties;
  if (!src) return <span className="share-poster-fallback" style={style}>{record.title.slice(0, 4)}</span>;
  return <img src={src} alt={record.title} decoding="async" />;
}`, "cached SharePoster");
  source = replaceOnce(source,
    `  const image = await safeLoadImage(primaryMedia(record)?.src);`,
    `  const image = await loadMediaImage(primaryMedia(record));`,
    "canvas cached image",
  );
  const safeLoader = `async function safeLoadImage(src?: string) {
  if (!src) return null;
  try {
    if (src.startsWith("data:") || src.startsWith("blob:")) return await imageFromUrl(src);
    const response = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await imageFromUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

function imageFromUrl(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

`;
  source = replaceOnce(source, safeLoader, "", "remove duplicate image loader");
  return source;
});

await patch("scripts/run-tests.mjs", (source) => {
  source = replaceOnce(source,
    `  const experienceCss = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");`,
    `  const experienceCss = await readFile(new URL("../src/experience.css", import.meta.url), "utf8");\n  const shareStudio = await readFile(new URL("../src/shareStudio.tsx", import.meta.url), "utf8");\n  const mediaCache = await readFile(new URL("../src/mediaCache.ts", import.meta.url), "utf8");`,
    "cache test sources",
  );
  source = replaceOnce(source,
    `  assert.match(experienceCss, /is-share-mode/);`,
    `  assert.match(experienceCss, /is-share-mode/);\n  assert.match(mediaCache, /caches\\.open\\(CACHE_NAME\\)/);\n  assert.match(mediaCache, /storage:\\$\\{asset\\.storagePath\\}/);\n  assert.match(appController, /preloadRecordMedia/);\n  assert.match(appController, /CustomEvent<\\{ storagePath\\?: string \\}>/);\n  assert.match(shareStudio, /loadMediaImage\\(primaryMedia\\(record\\)\\)/);\n  assert.match(shareStudio, /正在准备海报/);`,
    "cache architecture assertions",
  );
  return source;
});
