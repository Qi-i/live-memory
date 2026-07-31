import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, EventRecord, MediaAsset } from "./domain";
import { defaultSettings } from "./domain";
import { nowIso } from "./media";
import {
  deleteRecord,
  loadRecordsWithMigration,
  readSettings,
  replaceAllRecords,
  saveRecord,
  storageHealth,
  writeSettings,
} from "./storage";
import {
  autoSyncAll,
  friendlySupabaseErrorMessage,
  hasAccountCloudConfig,
  hasPersonalCloudConnection,
  hasSupabaseConfig,
  purgeRecordFromSupabase,
  purgeTextBackupFromAccount,
  recordPageView,
  refreshSignedMediaUrls,
  saveUserProfileBinding,
  syncAfterLogin,
} from "./supabase";
import type { SyncConflict } from "./supabase";
import { useAccess } from "./access";
import type { AppRoute } from "./experience";

const MEDIA_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
const MEDIA_REFRESH_EVENT = "live-memory:cloud-media-refresh";

function recordFingerprint(records: EventRecord[]) {
  return records.map((record) => `${record.id}:${record.updatedAt}:${record.deletedAt || ""}`).join("|");
}

function mediaFingerprint(records: EventRecord[]) {
  return records.flatMap((record) => record.media.map((asset) => `${asset.id}:${asset.src}:${asset.storagePath || ""}`)).join("|");
}

function mediaPathFingerprint(records: EventRecord[]) {
  return records.flatMap((record) => record.media.filter((asset) => asset.storagePath).map((asset) => `${record.id}:${asset.id}:${asset.storagePath}`)).join("|");
}

export function useAppController() {
  const access = useAccess();
  const isGuest = access.mode === "guest";
  const [records, setRecordsState] = useState<EventRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [route, setRoute] = useState<AppRoute>("archive");
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [zoomMedia, setZoomMedia] = useState<MediaAsset | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const initialized = useRef(false);
  const lastSyncFingerprint = useRef("");
  const toastTimer = useRef<number | null>(null);
  const recordsRef = useRef<EventRecord[]>([]);
  const mediaRefreshInFlight = useRef(false);
  const lastMediaRefreshAt = useRef(0);

  function setRecords(next: EventRecord[] | ((current: EventRecord[]) => EventRecord[])) {
    setRecordsState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      recordsRef.current = resolved;
      return resolved;
    });
  }

  useEffect(() => {
    let active = true;
    initialized.current = false;
    Promise.all([loadRecordsWithMigration(), Promise.resolve(readSettings())])
      .then(async ([loadedRecords, loadedSettings]) => {
        let nextRecords = loadedRecords;
        let nextSettings = loadedSettings;
        if (!isGuest && access.user) {
          try {
            const initialSync = await syncAfterLogin({ ...loadedSettings, onboardingComplete: true }, loadedRecords);
            nextRecords = initialSync.records;
            nextSettings = writeSettings({ ...initialSync.settings, onboardingComplete: true });
            await replaceAllRecords(nextRecords);
          } catch {
            nextSettings = writeSettings({ ...loadedSettings, onboardingComplete: true });
          }
        }
        if (!active) return;
        recordsRef.current = nextRecords;
        setRecordsState(nextRecords);
        setSettings(nextSettings);
        initialized.current = true;
      })
      .catch((error) => {
        if (!active) return;
        setToast(friendlySupabaseErrorMessage(error, "本地数据加载失败"));
        initialized.current = true;
      });
    return () => {
      active = false;
    };
  }, [access.mode, access.user, isGuest]);

  const records = recordsRef.current.length === 0 && recordsRef.current !== recordsRef.current ? [] : undefined;
  void records;

  const currentRecords = useMemo(() => recordsRef.current, [recordsRef.current]);
  void currentRecords;

  const activeRecords = useMemo(() => recordsRef.current.filter((record) => !record.deletedAt), [recordsRef.current]);
  const trashRecords = useMemo(() => recordsRef.current.filter((record) => Boolean(record.deletedAt)), [recordsRef.current]);
  const health = useMemo(() => storageHealth(recordsRef.current, settings), [recordsRef.current, settings]);
  const cloudMediaPaths = useMemo(() => mediaPathFingerprint(recordsRef.current), [recordsRef.current]);

  function flash(message: string) {
    if (!message) return;
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const snapshot = recordsRef.current;
    if (!initialized.current || isGuest || !access.user || editing || syncing || snapshot.length === 0) return;
    if (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings)) return;
    const fingerprint = recordFingerprint(snapshot);
    if (lastSyncFingerprint.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      lastSyncFingerprint.current = fingerprint;
      setSyncing(true);
      autoSyncAll(settings, recordsRef.current)
        .then(async (result) => {
          setSyncConflicts(result.conflicts);
          const nextFingerprint = recordFingerprint(result.records);
          if (nextFingerprint !== fingerprint) {
            await replaceAllRecords(result.records);
            setRecords(result.records);
            lastSyncFingerprint.current = nextFingerprint;
          }
          if (result.message) flash(result.message);
        })
        .catch((error) => {
          lastSyncFingerprint.current = "";
          flash(friendlySupabaseErrorMessage(error, "云同步暂时不可用"));
        })
        .finally(() => setSyncing(false));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [access.user, editing, isGuest, settings, syncing, activeRecords.length, trashRecords.length]);

  useEffect(() => {
    if (isGuest || !access.user || !hasPersonalCloudConnection(settings) || !settings.supabase.syncMedia || !cloudMediaPaths) return;
    let cancelled = false;

    async function refresh(force = false) {
      if (mediaRefreshInFlight.current) return;
      if (!force && lastMediaRefreshAt.current && Date.now() - lastMediaRefreshAt.current < MEDIA_REFRESH_INTERVAL) return;
      mediaRefreshInFlight.current = true;
      const snapshot = recordsRef.current;
      const before = mediaFingerprint(snapshot);
      try {
        const next = await refreshSignedMediaUrls(settings, snapshot);
        if (cancelled) return;
        lastMediaRefreshAt.current = Date.now();
        if (mediaFingerprint(next) !== before) {
          await replaceAllRecords(next);
          if (!cancelled) setRecords(next);
        }
      } catch (error) {
        if (force && !cancelled) flash(friendlySupabaseErrorMessage(error, "云端图片刷新失败"));
      } finally {
        mediaRefreshInFlight.current = false;
      }
    }

    void refresh(true);
    const interval = window.setInterval(() => void refresh(false), MEDIA_REFRESH_INTERVAL);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(false); };
    const onOnline = () => void refresh(true);
    const onMediaError = () => void refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener(MEDIA_REFRESH_EVENT, onMediaError);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(MEDIA_REFRESH_EVENT, onMediaError);
    };
  }, [access.user, cloudMediaPaths, isGuest, settings.supabase.anonKey, settings.supabase.mediaBucket, settings.supabase.ownerKey, settings.supabase.syncMedia, settings.supabase.url]);

  useEffect(() => {
    if (isGuest || !access.user || !hasAccountCloudConfig(settings)) return;
    recordPageView(route, document.referrer || undefined).catch(() => undefined);
  }, [access.user, isGuest, route, settings]);

  async function persistRecord(record: EventRecord) {
    const saved = await saveRecord({ ...record, updatedAt: nowIso() });
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(saved);
    setEditing(null);
    flash(isGuest ? "已保存到本次访客会话" : "已保存");
    return saved;
  }

  async function moveToTrash(record: EventRecord) {
    const saved = await saveRecord({ ...record, deletedAt: nowIso(), updatedAt: nowIso() });
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(null);
    flash("已移入回收站");
  }

  async function restoreRecord(record: EventRecord) {
    const saved = await saveRecord({ ...record, deletedAt: undefined, updatedAt: nowIso() });
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    flash("记录已恢复");
  }

  async function permanentlyDeleteRecord(record: EventRecord) {
    if (!isGuest && access.user && hasAccountCloudConfig(settings)) {
      await purgeTextBackupFromAccount(settings, record.id).catch(() => undefined);
    }
    if (!isGuest && settings.storageMode === "supabase" && hasSupabaseConfig(settings)) {
      await purgeRecordFromSupabase(settings, record.id).catch(() => undefined);
    }
    await deleteRecord(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
    flash("记录已永久删除");
  }

  async function updateSettings(next: AppSettings, message = "设置已保存") {
    const saved = writeSettings(next);
    setSettings(saved);
    if (!isGuest && access.user && hasAccountCloudConfig(saved)) {
      saveUserProfileBinding(saved).catch(() => undefined);
    }
    flash(message);
    return saved;
  }

  async function replaceRecords(next: EventRecord[], message: string) {
    await replaceAllRecords(next);
    setRecords(next);
    flash(message);
  }

  return {
    access,
    isGuest,
    route,
    setRoute,
    records: recordsRef.current,
    setRecords,
    activeRecords,
    trashRecords,
    settings,
    setSettings,
    health,
    selected,
    setSelected,
    editing,
    setEditing,
    importOpen,
    setImportOpen,
    zoomMedia,
    setZoomMedia,
    syncing,
    syncConflicts,
    setSyncConflicts,
    busy,
    setBusy,
    toast,
    flash,
    persistRecord,
    moveToTrash,
    restoreRecord,
    permanentlyDeleteRecord,
    updateSettings,
    replaceRecords,
  };
}

export type AppController = ReturnType<typeof useAppController>;
