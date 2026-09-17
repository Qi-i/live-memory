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
  signInStorageWithAccount,
  syncAfterLogin,
} from "./supabase";
import type { PersonalCloudRecoveryStatus, SyncConflict } from "./supabase";
import { makeGuestSettings, useAccess } from "./access";
import type { AppRoute } from "./experience";
import { seedRecords } from "./seeds";
import { preloadRecordMedia } from "./mediaCache";

const MEDIA_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
const MEDIA_REFRESH_EVENT = "live-memory:cloud-media-refresh";
const REMOTE_CHECK_INTERVAL = 5 * 60 * 1000;

function recordFingerprint(records: EventRecord[]) {
  return records.map((record) => `${record.id}:${record.updatedAt}:${record.deletedAt || ""}`).join("|");
}

function mediaFingerprint(records: EventRecord[]) {
  return records.flatMap((record) => record.media.map((asset) => `${asset.id}:${asset.src}:${asset.storagePath || ""}`)).join("|");
}

function mediaPathFingerprint(records: EventRecord[]) {
  return records.flatMap((record) => record.media.filter((asset) => asset.storagePath).map((asset) => `${record.id}:${asset.id}:${asset.storagePath}`)).join("|");
}

export function autoSyncFingerprint(records: EventRecord[], settings: AppSettings) {
  const recordPart = recordFingerprint(records);
  const mediaPart = records.flatMap((record) => record.media.map((asset) =>
    `${record.id}:${asset.id}:${asset.storagePath || (asset.src.startsWith("data:") ? "local-data" : asset.src)}`,
  )).join("|");
  const cloudPart = [
    hasPersonalCloudConnection(settings) ? "personal" : "",
    settings.supabase.url.trim(),
    settings.supabase.ownerKey ? "connected" : "",
    settings.supabase.syncMedia ? "media" : "text",
    hasAccountCloudConfig(settings) ? "account" : "",
  ].join(":");
  return `${recordPart}::${mediaPart}::${cloudPart}`;
}

function guestDemoRecords(): EventRecord[] {
  return seedRecords.map((record) => ({
    ...record,
    artists: [...record.artists],
    lineup: record.lineup.map((item) => ({ ...item })),
    media: record.media.map((asset) => ({ ...asset })),
    companions: [...record.companions],
    tags: [...record.tags],
    setlist: [...record.setlist],
    colors: [...record.colors],
  }));
}

export function useAppController() {
  const access = useAccess();
  const isGuest = access.mode === "guest";
  const [records, setRecordState] = useState<EventRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [route, setRoute] = useState<AppRoute>("archive");
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [zoomMedia, setZoomMedia] = useState<MediaAsset | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [cloudRecoveryNotice, setCloudRecoveryNotice] = useState("");
  const [personalCloudStatus, setPersonalCloudStatus] = useState<PersonalCloudRecoveryStatus>("not-configured");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const initialized = useRef(false);
  const lastSyncFingerprint = useRef("");
  const toastTimer = useRef<number | null>(null);
  const recordsRef = useRef<EventRecord[]>([]);
  const mediaRefreshInFlight = useRef(false);
  const lastMediaRefreshAt = useRef(0);
  const lastRemoteCheckAt = useRef(0);
  const syncOperationInFlight = useRef(false);
  const personalCloudRecoveryInFlight = useRef(false);

  function setRecords(next: EventRecord[] | ((current: EventRecord[]) => EventRecord[])) {
    setRecordState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      recordsRef.current = resolved;
      return resolved;
    });
  }

  useEffect(() => {
    let active = true;
    initialized.current = false;

    if (isGuest) {
      const demoRecords = guestDemoRecords();
      const guestSettings = makeGuestSettings();
      recordsRef.current = demoRecords;
      setRecordState(demoRecords);
      setSettings(guestSettings);
      void preloadRecordMedia(demoRecords);
      lastSyncFingerprint.current = recordFingerprint(demoRecords);
      initialized.current = true;
      return () => { active = false; };
    }

    Promise.all([loadRecordsWithMigration(), Promise.resolve(readSettings())])
      .then(async ([loadedRecords, loadedSettings]) => {
        let nextRecords = loadedRecords;
        let nextSettings = loadedSettings;
        if (access.user) {
          try {
            const initialSync = await syncAfterLogin({ ...loadedSettings, onboardingComplete: true }, loadedRecords);
            nextRecords = initialSync.records;
            nextSettings = writeSettings({ ...initialSync.settings, onboardingComplete: true });
            setPersonalCloudStatus(initialSync.personalCloudStatus);
            if (initialSync.personalCloudStatus === "reconnect-needed") {
              setCloudRecoveryNotice("个人云端连接尚未恢复，系统会在当前页面自动重试；文字档案不受影响。");
            }
            await replaceAllRecords(nextRecords);
          } catch {
            nextSettings = writeSettings({ ...loadedSettings, onboardingComplete: true });
          }
        }
        if (!active) return;
        const loadedActiveCount = loadedRecords.filter((record) => !record.deletedAt).length;
        const nextActiveCount = nextRecords.filter((record) => !record.deletedAt).length;
        recordsRef.current = nextRecords;
        setRecordState(nextRecords);
        setSettings(nextSettings);
        if (access.user && nextActiveCount > loadedActiveCount) setCloudRecoveryNotice(`已从云端恢复 ${nextActiveCount - loadedActiveCount} 条其他设备记录，可直接刷新云端图片。`);
        void preloadRecordMedia(nextRecords);
        lastSyncFingerprint.current = "";
        initialized.current = true;
      })
      .catch((error) => {
        if (!active) return;
        setToast(friendlySupabaseErrorMessage(error, "本机记录加载失败"));
        initialized.current = true;
      });
    return () => { active = false; };
  }, [access.mode, access.user, isGuest]);

  const activeRecords = useMemo(() => records.filter((record) => !record.deletedAt), [records]);
  const trashRecords = useMemo(() => records.filter((record) => Boolean(record.deletedAt)), [records]);
  const health = useMemo(() => storageHealth(records, settings), [records, settings]);
  const cloudMediaPaths = useMemo(() => mediaPathFingerprint(records), [records]);

  function flash(message: string) {
    if (!message) return;
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  async function recoverPersonalCloud(silent = false) {
    if (isGuest || !access.user || settings.storageMode !== "supabase" || !hasSupabaseConfig(settings)) {
      setPersonalCloudStatus("not-configured");
      return false;
    }
    if (hasPersonalCloudConnection(settings) && personalCloudStatus === "connected") return true;
    if (personalCloudRecoveryInFlight.current) return false;
    personalCloudRecoveryInFlight.current = true;
    setPersonalCloudStatus("reconnect-needed");
    const delays = [0, 650, 1800];
    let lastError: unknown = null;
    try {
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        try {
          const connected = await signInStorageWithAccount(settings);
          const connectedSettings = writeSettings(connected.settings);
          let nextRecords = recordsRef.current;
          if (connectedSettings.supabase.syncMedia) {
            nextRecords = await refreshSignedMediaUrls(connectedSettings, nextRecords, { force: true });
            await replaceAllRecords(nextRecords);
            setRecords(nextRecords);
            void preloadRecordMedia(nextRecords);
            lastMediaRefreshAt.current = Date.now();
          }
          setSettings(connectedSettings);
          setPersonalCloudStatus("connected");
          setCloudRecoveryNotice(connectedSettings.supabase.syncMedia ? "个人云端已经自动恢复，图片链接已重新签名。" : "个人云端已经自动恢复。");
          if (!silent) flash("个人云端已恢复");
          return true;
        } catch (error) {
          lastError = error;
        }
      }
      setPersonalCloudStatus("reconnect-needed");
      if (!silent && lastError) flash(friendlySupabaseErrorMessage(lastError, "个人云端恢复失败"));
      return false;
    } finally {
      personalCloudRecoveryInFlight.current = false;
    }
  }

  useEffect(() => {
    if (isGuest || !access.user || settings.storageMode !== "supabase" || !hasSupabaseConfig(settings) || personalCloudStatus === "connected") return;
    const retryPersonalCloud = () => void recoverPersonalCloud(true);
    const initial = window.setTimeout(retryPersonalCloud, 1200);
    window.addEventListener("focus", retryPersonalCloud);
    window.addEventListener("online", retryPersonalCloud);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("focus", retryPersonalCloud);
      window.removeEventListener("online", retryPersonalCloud);
    };
  }, [access.user, isGuest, personalCloudStatus, settings.storageMode, settings.supabase.anonKey, settings.supabase.url]);

  useEffect(() => {
    if (!initialized.current || isGuest || !access.user || editing || syncing || syncOperationInFlight.current || records.length === 0) return;
    if (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings)) return;
    const fingerprint = autoSyncFingerprint(records, settings);
    if (lastSyncFingerprint.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      lastSyncFingerprint.current = fingerprint;
      syncOperationInFlight.current = true;
      setSyncing(true);
      autoSyncAll(settings, recordsRef.current)
        .then(async (result) => {
          setSyncConflicts(result.conflicts);
          const nextFingerprint = autoSyncFingerprint(result.records, settings);
          if (nextFingerprint !== fingerprint) {
            await replaceAllRecords(result.records);
            setRecords(result.records);
          }
          lastSyncFingerprint.current = nextFingerprint;
          const syncedSettings = writeSettings({ ...settings, lastSyncAt: nowIso() });
          setSettings(syncedSettings);
          if (result.message) flash(result.message);
        })
        .catch((error) => {
          lastSyncFingerprint.current = "";
          flash(friendlySupabaseErrorMessage(error, "云同步暂时不可用"));
        })
        .finally(() => { syncOperationInFlight.current = false; setSyncing(false); });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [access.user, editing, isGuest, records, settings, syncing]);

  useEffect(() => {
    if (isGuest || !access.user || !hasPersonalCloudConnection(settings) || !settings.supabase.syncMedia || !cloudMediaPaths) return;
    let cancelled = false;

    async function refresh(force = false, storagePath?: string) {
      if (mediaRefreshInFlight.current) return;
      if (!force && lastMediaRefreshAt.current && Date.now() - lastMediaRefreshAt.current < MEDIA_REFRESH_INTERVAL) return;
      mediaRefreshInFlight.current = true;
      const snapshot = recordsRef.current;
      const before = mediaFingerprint(snapshot);
      try {
        const next = await refreshSignedMediaUrls(settings, snapshot, { force, storagePath });
        void preloadRecordMedia(next);
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

    void refresh(false);
    const interval = window.setInterval(() => void refresh(false), MEDIA_REFRESH_INTERVAL);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(false); };
    const onOnline = () => void refresh(false);
    const onMediaError = (event: Event) => {
      const storagePath = (event as CustomEvent<{ storagePath?: string }>).detail?.storagePath;
      void refresh(true, storagePath);
    };
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
    if (isGuest || !access.user || (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings))) return;
    const check = () => { if (document.visibilityState === "visible") void checkRemoteUpdates(true); };
    const initial = window.setTimeout(check, 1800);
    const interval = window.setInterval(check, REMOTE_CHECK_INTERVAL);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const onOnline = () => void checkRemoteUpdates(false);
    window.addEventListener("focus", check);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [access.user, isGuest, settings.supabase.ownerKey, settings.supabase.url]);

  useEffect(() => {
    if (isGuest || !access.user || !hasAccountCloudConfig(settings)) return;
    recordPageView(route, document.referrer || undefined).catch(() => undefined);
  }, [access.user, isGuest, route, settings]);

  async function runCloudSync(label: string, silent = false) {
    if (isGuest) { if (!silent) flash("示例模式无需云同步"); return false; }
    if (!access.user || (!hasAccountCloudConfig(settings) && !hasPersonalCloudConnection(settings))) { if (!silent) flash("尚未连接可用云端"); return false; }
    if (syncOperationInFlight.current) return false;
    syncOperationInFlight.current = true;
    setSyncing(true);
    const before = recordFingerprint(recordsRef.current);
    try {
      const result = await autoSyncAll(settings, recordsRef.current);
      setSyncConflicts(result.conflicts);
      const changed = recordFingerprint(result.records) !== before || mediaFingerprint(result.records) !== mediaFingerprint(recordsRef.current);
      if (changed) {
        await replaceAllRecords(result.records);
        setRecords(result.records);
        void preloadRecordMedia(result.records);
      }
      const syncedSettings = writeSettings({ ...settings, lastSyncAt: nowIso() });
      setSettings(syncedSettings);
      lastSyncFingerprint.current = autoSyncFingerprint(result.records, syncedSettings);
      if (!silent) flash(changed ? `${label}：已合并其他设备更新` : `${label}：当前已是最新`);
      return changed;
    } catch (error) {
      if (!silent) flash(friendlySupabaseErrorMessage(error, `${label}失败`));
      return false;
    } finally {
      syncOperationInFlight.current = false;
      setSyncing(false);
    }
  }

  async function syncNow() {
    return runCloudSync("立即同步");
  }

  async function checkRemoteUpdates(silent = false) {
    if (silent && lastRemoteCheckAt.current && Date.now() - lastRemoteCheckAt.current < REMOTE_CHECK_INTERVAL) return false;
    lastRemoteCheckAt.current = Date.now();
    const changed = await runCloudSync("检查其他设备更新", silent);
    if (changed && silent) flash("已自动合并其他设备的新记录");
    return changed;
  }

  async function refreshCloudMedia() {
    if (isGuest) { flash("示例模式没有云端图片"); return false; }
    if (!hasPersonalCloudConnection(settings) || !settings.supabase.syncMedia) { flash("当前未开启个人云端图片同步"); return false; }
    if (mediaRefreshInFlight.current) return false;
    mediaRefreshInFlight.current = true;
    const snapshot = recordsRef.current;
    const before = mediaFingerprint(snapshot);
    try {
      const next = await refreshSignedMediaUrls(settings, snapshot, { force: true });
      void preloadRecordMedia(next);
      lastMediaRefreshAt.current = Date.now();
      if (mediaFingerprint(next) !== before) {
        await replaceAllRecords(next);
        setRecords(next);
      }
      flash("云端图片链接已刷新");
      return true;
    } catch (error) {
      flash(friendlySupabaseErrorMessage(error, "云端图片刷新失败"));
      return false;
    } finally {
      mediaRefreshInFlight.current = false;
    }
  }

  async function persistRecord(record: EventRecord) {
    const nextRecord = { ...record, updatedAt: nowIso() };
    const saved = isGuest ? nextRecord : await saveRecord(nextRecord);
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(saved);
    setEditing(null);
    flash(isGuest ? "已更新示例（关闭页面后不会保留）" : "已保存");
    return saved;
  }

  async function moveToTrash(record: EventRecord) {
    const nextRecord = { ...record, deletedAt: nowIso(), updatedAt: nowIso() };
    const saved = isGuest ? nextRecord : await saveRecord(nextRecord);
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(null);
    flash(isGuest ? "已从当前示例中移除" : "已移入回收站");
  }

  async function restoreRecord(record: EventRecord) {
    const nextRecord = { ...record, deletedAt: undefined, updatedAt: nowIso() };
    const saved = isGuest ? nextRecord : await saveRecord(nextRecord);
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    flash("记录已恢复");
  }

  async function permanentlyDeleteRecord(record: EventRecord) {
    if (isGuest) {
      setRecords((current) => current.filter((item) => item.id !== record.id));
      flash("已从当前示例中删除");
      return;
    }
    if (access.user && hasAccountCloudConfig(settings)) {
      await purgeTextBackupFromAccount(settings, record.id).catch(() => undefined);
    }
    if (settings.storageMode === "supabase" && hasSupabaseConfig(settings)) {
      await purgeRecordFromSupabase(settings, record.id).catch(() => undefined);
    }
    await deleteRecord(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
    flash("记录已永久删除");
  }

  async function updateSettings(next: AppSettings, message = "设置已保存") {
    if (isGuest) {
      setSettings(next);
      flash("示例设置已更新（关闭页面后不会保留）");
      return next;
    }
    const saved = writeSettings(next);
    setSettings(saved);
    if (access.user && hasAccountCloudConfig(saved)) {
      saveUserProfileBinding(saved).catch(() => undefined);
    }
    flash(message);
    return saved;
  }

  async function replaceRecords(next: EventRecord[], message: string) {
    if (!isGuest) await replaceAllRecords(next);
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
    cloudRecoveryNotice,
    dismissCloudRecoveryNotice: () => setCloudRecoveryNotice(""),
    personalCloudStatus,
    recoverPersonalCloud,
    syncNow,
    checkRemoteUpdates,
    refreshCloudMedia,
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
