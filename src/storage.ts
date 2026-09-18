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

const DB_NAME = "echo-archive-v2";
const DB_VERSION = 1;
const RECORD_STORE = "records";
const SETTINGS_KEY = "echoArchiveSettingsV2";
const FALLBACK_RECORDS_KEY = "echoArchiveRecordsV2";
const GUEST_SESSION_KEY = "live-memory-guest-session";
const UNSCOPED_OWNER_KEY = "live-memory-unscoped-data-owner";

const LEGACY_DB_NAME = "echo-archive-local";
const LEGACY_STORE = "events";
const LEGACY_LOCAL_KEY = "echoArchiveEvents";
const MIGRATION_DONE_KEY = "echoArchiveV2MigrationDone";

let dbPromise: Promise<IDBDatabase> | null = null;
let dbPromiseName = "";
let storageScope = "";
let allowLegacyScopeMigration = false;
let guestRecords: EventRecord[] = [];

function normalizeStorageScope(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

export function storageScopeKey(base: string, scope = storageScope) {
  const normalized = normalizeStorageScope(scope);
  return normalized ? `${base}:${normalized}` : base;
}

export function currentStorageScope() {
  return storageScope;
}

export function legacyUnscopedAccountUsername() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<AppSettings>;
    return String(raw.account?.username || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function setStorageScope(scope: string, allowLegacyMigration = false) {
  const normalized = normalizeStorageScope(scope);
  if (storageScope === normalized && allowLegacyScopeMigration === allowLegacyMigration) return;
  const previousDb = dbPromise;
  storageScope = normalized;
  allowLegacyScopeMigration = allowLegacyMigration;
  dbPromise = null;
  dbPromiseName = "";
  void previousDb?.then((db) => db.close()).catch(() => undefined);
}

export function clearStorageScope() {
  setStorageScope("", false);
}

function isGuestSession() {
  return typeof sessionStorage !== "undefined" && sessionStorage.getItem(GUEST_SESSION_KEY) === "1";
}

function guestSettings(value: Partial<AppSettings> = {}): AppSettings {
  return {
    ...defaultSettings,
    ...value,
    defaultView: value.defaultView || defaultSettings.defaultView,
    posterColumns: Math.min(6, Math.max(2, Number(value.posterColumns || defaultSettings.posterColumns))),
    storageMode: "local",
    onboardingComplete: true,
    account: {
      username: "guest",
      nickname: "访客",
      avatarUrl: "",
      recoveryEmail: "",
    },
    accountBackup: { ...defaultSettings.accountBackup },
    map: { ...defaultSettings.map },
    supabase: {
      url: "",
      anonKey: "",
      mediaBucket: "echo-media",
      syncMedia: false,
      ownerKey: "",
    },
    lastSyncAt: undefined,
  };
}

function openDb() {
  if (!storageScope) return Promise.reject(new Error("账号本地存储尚未初始化"));
  const dbName = storageScopeKey(DB_NAME);
  if (!dbPromise || dbPromiseName !== dbName) {
    dbPromiseName = dbName;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
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
  if (isGuestSession()) return guestRecords.map(normalizeRecord);
  if (!storageScope) return [];

  const current = await listRecords();
  if (current.length > 0) return current;

  const migrationKey = storageScopeKey(MIGRATION_DONE_KEY);
  if (!localStorage.getItem(migrationKey)) {
    const migrated = await migrateUnscopedRecordsForCurrentScope();
    localStorage.setItem(migrationKey, "1");
    if (migrated.length) return listRecords();
  }
  return [];
}

export async function listRecords() {
  if (isGuestSession()) {
    return guestRecords.map(normalizeRecord).sort((a, b) => b.date.localeCompare(a.date));
  }
  if (!storageScope) return [];
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
  if (isGuestSession()) {
    guestRecords = guestRecords.filter((item) => item.id !== next.id).concat(next);
    return next;
  }
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
  if (isGuestSession()) {
    guestRecords = guestRecords.filter((item) => item.id !== id);
    return;
  }
  try {
    const store = await objectStore("readwrite");
    await requestToPromise(store.delete(id));
  } catch {
    writeFallbackRecords(readFallbackRecords().filter((item) => item.id !== id));
  }
}

export async function replaceAllRecords(records: EventRecord[]) {
  const normalized = records.map(normalizeRecord);
  if (isGuestSession()) {
    guestRecords = normalized;
    return;
  }
  try {
    const store = await objectStore("readwrite");
    await requestToPromise(store.clear());
    await Promise.all(normalized.map((record) => requestToPromise(store.put(record))));
  } catch {
    writeFallbackRecords(normalized);
  }
}

function canMigrateLegacyScope() {
  if (!storageScope || !allowLegacyScopeMigration) return false;
  const claimedBy = localStorage.getItem(UNSCOPED_OWNER_KEY);
  return !claimedBy || claimedBy === storageScope;
}

function claimLegacyScope() {
  if (storageScope && !localStorage.getItem(UNSCOPED_OWNER_KEY)) {
    localStorage.setItem(UNSCOPED_OWNER_KEY, storageScope);
  }
}

export function readSettings(): AppSettings {
  if (isGuestSession()) return guestSettings();

  try {
    if (!storageScope) {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
    }

    const key = storageScopeKey(SETTINGS_KEY);
    let raw = localStorage.getItem(key);
    if (!raw && canMigrateLegacyScope()) {
      const legacyRaw = localStorage.getItem(SETTINGS_KEY);
      if (legacyRaw) {
        raw = legacyRaw;
        localStorage.setItem(key, legacyRaw);
        claimLegacyScope();
      }
    }
    return normalizeSettings(JSON.parse(raw || "{}"));
  } catch {
    return { ...defaultSettings };
  }
}

export function writeSettings(settings: AppSettings) {
  if (isGuestSession()) return guestSettings(settings);
  const normalized = normalizeSettings(settings);
  if (storageScope) {
    localStorage.setItem(storageScopeKey(SETTINGS_KEY), JSON.stringify(normalized));
  }
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
  if (!storageScope) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(storageScopeKey(FALLBACK_RECORDS_KEY)) || "[]");
    return Array.isArray(rows) ? (rows as EventRecord[]) : [];
  } catch {
    return [];
  }
}

function writeFallbackRecords(records: EventRecord[]) {
  if (!storageScope) return;
  localStorage.setItem(storageScopeKey(FALLBACK_RECORDS_KEY), JSON.stringify(records));
}

function readUnscopedFallbackRecords() {
  try {
    const rows = JSON.parse(localStorage.getItem(FALLBACK_RECORDS_KEY) || "[]");
    return Array.isArray(rows) ? (rows as EventRecord[]) : [];
  } catch {
    return [];
  }
}

function readV2RecordsFromDatabase(name: string): Promise<EventRecord[]> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(RECORD_STORE, "readonly");
      const getAll = tx.objectStore(RECORD_STORE).getAll();
      getAll.onsuccess = () => {
        const rows = Array.isArray(getAll.result) ? (getAll.result as EventRecord[]) : [];
        db.close();
        resolve(rows);
      };
      getAll.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}

async function migrateUnscopedRecordsForCurrentScope() {
  if (!canMigrateLegacyScope()) return [];

  const currentV2 = await readV2RecordsFromDatabase(DB_NAME);
  const fallbackV2 = currentV2.length ? [] : readUnscopedFallbackRecords();
  const legacy = currentV2.length || fallbackV2.length ? [] : await readLegacyRecords();
  const records = currentV2.length
    ? currentV2.map(normalizeRecord)
    : fallbackV2.length
      ? fallbackV2.map(normalizeRecord)
      : legacy;

  if (records.length) {
    await replaceAllRecords(records);
    claimLegacyScope();
  }
  return records;
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

function normalizeMediaTombstones(value: EventRecord["mediaTombstones"]) {
  const byId = new Map<string, NonNullable<EventRecord["mediaTombstones"]>[number]>();
  for (const item of value || []) {
    const id = String(item?.id || "").trim();
    const deletedAt = String(item?.deletedAt || "").trim();
    if (!id || !deletedAt) continue;
    const previous = byId.get(id);
    if (!previous || deletedAt > previous.deletedAt) {
      byId.set(id, {
        id,
        storagePath: item.storagePath ? String(item.storagePath) : undefined,
        deletedAt,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeRecord(record: EventRecord): EventRecord {
  const timestamp = record.updatedAt || nowIso();
  const artists = splitTextList(record.artists).slice(0, 80);
  const mediaTombstones = normalizeMediaTombstones(record.mediaTombstones);
  const tombstoneById = new Map(mediaTombstones.map((item) => [item.id, item]));
  const media = (record.media || [])
    .map((asset) => ({ ...asset, src: normalizeLegacyAssetUrl(asset.src), recordId: record.id }))
    .filter((asset) => {
      const tombstone = tombstoneById.get(asset.id);
      return !tombstone || tombstone.deletedAt < asset.updatedAt;
    });
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
    media,
    mediaTombstones,
    favorite: Boolean(record.favorite),
    colors: [record.colors?.[0] || "#101418", record.colors?.[1] || "#dfff4f"],
    createdAt: record.createdAt || timestamp,
    updatedAt: timestamp,
    deletedAt: record.deletedAt || undefined,
    syncedAt: record.syncedAt || undefined,
  };
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const legacySupabase = (value.supabase || {}) as Partial<AppSettings["supabase"]> & { email?: string };
  const supabase = { ...defaultSettings.supabase, ...legacySupabase };
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
