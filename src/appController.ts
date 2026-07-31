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
  hasAccountCloudConfig,
  hasPersonalCloudConnection,
  hasSupabaseConfig,
  purgeRecordFromSupabase,
  purgeTextBackupFromAccount,
  recordPageView,
  refreshSignedMediaUrls,
  saveUserProfileBinding,
} from "./supabase";
import type { SyncConflict } from "./supabase";
import { useAccess } from "./access";
import type { AppRoute } from "./experience";

const MEDIA_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

function recordFingerprint(records: EventRecord[]) {
  return records.map((record) => `${record.id}:${record.updatedAt}:${record.deletedAt || ""}`).join("|");
}

function mediaFingerprint(records: EventRecord[]) {
  return records.flatMap((record) => record.media.map((asset) => `${asset.id}:${asset.src}:${asset.storagePath || ""}`)).join("|");
}

export function useAppController() {
  const access = useAccess();
  const isGuest = access.mode === "guest";
  const [records, setRecords] = useState<EventRecord[]>([]);
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

  useEffect(() => {
    let active = true;
    Promise.all([loadRecordsWithMigration(), Promise.resolve(readSettings())])
      .then(([loadedRecords, loadedSettings]) => {
        if (!active) return;
        setRecords(loadedRecords);
        setSettings(loadedSettings);
        initialized.current = true;
      });
    return () => {
      active = false;
    };
  }, [access.mode]);

  const activeRecords = useMemo(() => records.filter((record) => !record.deletedAt), [records]);
  const trashRecords = useMemo(() => records.filter((record) => Boolean(record.deletedAt)), [records]);
  const health = useMemo(() => storageHealth(records, settings), [records, settings]);

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
    if (!initialized.current || isGuest || !access.user || editing || syncing || !settings.onboardingComplete || records.length === 0) return;
    if (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings)) return;
    const fingerprint = recordFingerprint(records);
    if (lastSyncFingerprint.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      lastSyncFingerprint.current = fingerprint;
      setSyncing(true);
      autoSyncAll(settings, records)
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
          flash(error instanceof Error ? error.message : "云同步暂时不可用");
        })
        .finally(() => setSyncing(false));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [access.user, editing, isGuest, records, settings, syncing]);

  useEffect(() => {
    if (isGuest || !access.user || !hasPersonalCloudConnection(settings) || !settings.supabase.syncMedia || records.length === 0) return;
    let cancelled = false;
    async function refresh() {
      const before = mediaFingerprint(records);
      try {
        const next = await refreshSignedMediaUrls(settings, records);
        if (cancelled || mediaFingerprint(next) === before) return;
        await replaceAllRecords(next);
        if (!cancelled) setRecords(next);
      } catch {
        // Media refresh is non-fatal; explicit refresh remains available in settings.
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, MEDIA_REFRESH_INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [access.user, isGuest, records.length, settings.supabase.anonKey, settings.supabase.mediaBucket, settings.supabase.ownerKey, settings.supabase.syncMedia, settings.supabase.url]);

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
    records,
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
