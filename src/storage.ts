import {
  AppSettings,
  EventRecord,
  MediaAsset,
  StorageHealth,
  createId,
  defaultSettings,
  normalizeExternalUrl,
  normalizeCategory,
  normalizeRecordState,
  normalizeSource,
  normalizeStatus,
  splitTextList,
} from "./domain";
import { makeMedia, nowIso } from "./media";
import { normalizeLegacyAssetUrl } from "./posterRegistry";
import { seedRecords } from "./seeds";

const DB_NAME = "echo-archive-v2";
const DB_VERSION = 1;
const RECORD_STORE = "records";
const SETTINGS_KEY = "echoArchiveSettingsV2";

const LEGACY_DB_NAME = "echo-archive-local";
const LEGACY_STORE = "events";
const LEGACY_LOCAL_KEY = "echoArchiveEvents";
const MIGRATION_DONE_KEY = "echoArchiveV2MigrationDone";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          const store = db.createObjectStore(RECORD_STORE, { keyPath: "id" });
          store.createIndex("date", "date");
          store.createIndex("city", "city");
          store.createIndex("category", "category");
          store.createIndex("status", "status");
        }
      };
    });
  }
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function objectStore(mode: IDBTransactionMode) {
  const db = await openDb();
  return db.transaction(RECORD_STORE, mode).objectStore(RECORD_STORE);
}

export async function loadRecordsWithMigration() {
  const current = await listRecords();
  if (current.length > 0) return current;

  const migrated = localStorage.getItem(MIGRATION_DONE_KEY) ? [] : await readLegacyRecords();
  const records = migrated.length ? migrated : seedRecords;
  await replaceAllRecords(records);
  localStorage.setItem(MIGRATION_DONE_KEY, "1");
  return listRecords();
}

export async function listRecords() {
  try {
    const store = await objectStore("readonly");
    const rows = await requestToPromise<EventRecord[]>(store.getAll());
    return rows.map(normalizeRecord).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    const fallback = readFallbackRecords();
    return fallback.map(normalizeRecord).sort((a, b) => b.date.localeCompare(a.date));
  }
}

export async function saveRecord(record: EventRecord) {
  const next = normalizeRecord({ ...record, updatedAt: nowIso() });
  try {
    const store = await objectStore("readwrite");
    await requestToPromise(store.put(next));
  } catch {
    const rows = readFallbackRecords().filter((item) => item.id !== next.id).concat(next);
    writeFallbackRecords(rows);
  }
  return next;
}

export async function deleteRecord(id: string) {
  try {
    const store = await objectStore("readwrite");
    await requestToPromise(store.delete(id));
  } catch {
    writeFallbackRecords(readFallbackRecords().filter((item) => item.id !== id));
  }
}

export async function replaceAllRecords(records: EventRecord[]) {
  const normalized = records.map(normalizeRecord);
  try {
    const store = await objectStore("readwrite");
    await requestToPromise(store.clear());
    await Promise.all(normalized.map((record) => requestToPromise(store.put(record))));
  } catch {
    writeFallbackRecords(normalized);
  }
}

export function readSettings(): AppSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch {
    return { ...defaultSettings };
  }
}

export function writeSettings(settings: AppSettings) {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function storageHealth(records: EventRecord[], settings: AppSettings): StorageHealth {
  const activeRecords = records.filter((record) => !record.deletedAt);
  const media = activeRecords.flatMap((record) => record.media);
  return {
    localRecords: activeRecords.length,
    mediaAssets: media.length,
    localOnlyMedia: media.filter((asset) => asset.src.startsWith("data:") && !asset.storagePath).length,
    remoteMedia: media.filter((asset) => Boolean(asset.storagePath)).length,
    lastSyncAt: settings.lastSyncAt,
  };
}

function readFallbackRecords() {
  try {
    const rows = JSON.parse(localStorage.getItem("echoArchiveRecordsV2") || "[]");
    return Array.isArray(rows) ? (rows as EventRecord[]) : [];
  } catch {
    return [];
  }
}

function writeFallbackRecords(records: EventRecord[]) {
  localStorage.setItem("echoArchiveRecordsV2", JSON.stringify(records));
}

async function readLegacyRecords() {
  const rows = await readLegacyIndexedDbRecords();
  if (rows.length) return rows.map(legacyToRecord);
  try {
    const localRows = JSON.parse(localStorage.getItem(LEGACY_LOCAL_KEY) || "[]");
    return Array.isArray(localRows) ? localRows.map(legacyToRecord) : [];
  } catch {
    return [];
  }
}

function readLegacyIndexedDbRecords(): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME, 1);
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(LEGACY_STORE, "readonly");
      const store = tx.objectStore(LEGACY_STORE);
      const getAll = store.getAll();
      getAll.onsuccess = () => resolve((getAll.result || []) as Record<string, unknown>[]);
      getAll.onerror = () => resolve([]);
    };
  });
}

function legacyToRecord(row: Record<string, unknown>): EventRecord {
  const timestamp = String(row.updatedAt || row.createdAt || nowIso());
  const id = String(row.id || createId("legacy"));
  const artists = splitTextList(row.artists);
  const media: MediaAsset[] = [];
  const poster = normalizeLegacyAssetUrl(String(row.poster || ""));
  const seatMap = normalizeLegacyAssetUrl(String(row.seatMap || ""));
  if (poster) media.push(makeMedia(id, "poster", poster, "主海报", poster.startsWith("data:") ? "local" : "external"));
  if (seatMap) media.push(makeMedia(id, "seatMap", seatMap, "座位图", seatMap.startsWith("data:") ? "local" : "external"));
  const gallery = Array.isArray(row.gallery) ? row.gallery : [];
  gallery.forEach((src, index) => {
    const url = normalizeLegacyAssetUrl(String(src || ""));
    if (url) media.push(makeMedia(id, "livePhoto", url, `现场照片 ${index + 1}`, url.startsWith("data:") ? "local" : "external"));
  });

  return normalizeRecord({
    schemaVersion: 2,
    id,
    title: String(row.title || "未命名演出"),
    category: normalizeCategory(row.category),
    status: normalizeStatus(row.status, String(row.date || "")),
    recordState: normalizeRecordState(row.recordState),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")) ? String(row.date) : new Date().toISOString().slice(0, 10),
    time: String(row.time || ""),
    city: String(row.city || ""),
    venue: String(row.venue || ""),
    artists,
    lineup: artists.map((name) => ({ name, role: "artist" })),
    price: typeof row.price === "number" ? row.price : Number(row.price) || null,
    seat: String(row.seat || ""),
    companions: splitTextList(row.companions),
    tags: splitTextList(row.tags),
    note: String(row.note || ""),
    setlist: splitTextList(row.setlist),
    sourceChannel: normalizeSource(row.sourceChannel),
    sourceUrl: String(row.sourceUrl || ""),
    importConfidence: typeof row.importConfidence === "number" ? row.importConfidence : undefined,
    media,
    favorite: Boolean(row.favorite),
    colors: Array.isArray(row.colors) ? [String(row.colors[0] || "#101418"), String(row.colors[1] || "#dfff4f")] : ["#101418", "#dfff4f"],
    createdAt: String(row.createdAt || timestamp),
    updatedAt: timestamp,
  });
}

export function normalizeRecord(record: EventRecord): EventRecord {
  const timestamp = record.updatedAt || nowIso();
  const artists = splitTextList(record.artists).slice(0, 80);
  return {
    ...record,
    schemaVersion: 2,
    title: String(record.title || "未命名演出").slice(0, 120),
    category: normalizeCategory(record.category),
    status: normalizeStatus(record.status, record.date),
    recordState: normalizeRecordState(record.recordState),
    date: /^\d{4}-\d{2}-\d{2}$/.test(record.date || "") ? record.date : new Date().toISOString().slice(0, 10),
    time: String(record.time || "").slice(0, 8),
    city: String(record.city || "").slice(0, 40),
    venue: String(record.venue || "").slice(0, 120),
    artists,
    lineup: record.lineup?.length ? record.lineup : artists.map((name) => ({ name, role: "artist" })),
    companions: splitTextList(record.companions).slice(0, 40),
    tags: splitTextList(record.tags).slice(0, 40),
    setlist: splitTextList(record.setlist).slice(0, 120),
    sourceChannel: normalizeSource(record.sourceChannel),
    sourceUrl: normalizeExternalUrl(record.sourceUrl) || undefined,
    media: (record.media || []).map((asset) => ({ ...asset, src: normalizeLegacyAssetUrl(asset.src), recordId: record.id })),
    favorite: Boolean(record.favorite),
    colors: [record.colors?.[0] || "#101418", record.colors?.[1] || "#dfff4f"],
    createdAt: record.createdAt || timestamp,
    updatedAt: timestamp,
    deletedAt: record.deletedAt || undefined,
  };
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const legacySupabase = (value.supabase || {}) as Partial<AppSettings["supabase"]> & { email?: string };
  const supabase = { ...defaultSettings.supabase, ...legacySupabase };
  // v2.0 initially shipped with a bucket default that did not match the SQL migration.
  if (supabase.mediaBucket === "private-data") supabase.mediaBucket = "echo-media";
  const account = {
    ...defaultSettings.account,
    ...(value.account || {}),
    recoveryEmail: value.account?.recoveryEmail || legacySupabase.email || defaultSettings.account.recoveryEmail,
  };
  delete (supabase as typeof supabase & { email?: string }).email;
  const savedView = value.defaultView as string | undefined;
  const defaultView = savedView === "masonry" ? "poster" : value.defaultView || defaultSettings.defaultView;
  const posterColumns = Math.min(6, Math.max(2, Number(value.posterColumns || defaultSettings.posterColumns)));
  const storageMode = value.storageMode || (supabase.url && supabase.anonKey ? "supabase" : defaultSettings.storageMode);
  return {
    ...defaultSettings,
    ...value,
    defaultView,
    posterColumns,
    storageMode,
    onboardingComplete: Boolean(value.onboardingComplete),
    account,
    accountBackup: { ...defaultSettings.accountBackup, ...(value.accountBackup || {}) },
    map: { ...defaultSettings.map, ...(value.map || {}) },
    supabase,
  };
}
