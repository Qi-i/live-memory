import {
  AlertTriangle,
  Cloud,
  CloudDownload,
  ChevronDown,
  Import,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "./domain";
import { effectiveStatus } from "./domain";
import { useAppController } from "./appController";
import { ArchivePage } from "./archive";
import type { ArchiveLayout, ShareFormat } from "./archive";
import { ExperienceShell } from "./experience";
import { AdminPage, StatsPage } from "./statsPage";
import { GuestSettingsPage, SettingsPage } from "./settingsPage";
import {
  ConfirmDialog,
  DetailDrawer,
  ImageZoom,
  ImportDrawer,
  RecordEditor,
} from "./overlays";
import type { ConfirmAction } from "./overlays";
import { SyncConflictDialog } from "./syncConflictDialog";
import { blankRecord } from "./seeds";
import { duplicateRecordForNextShow } from "./recordActions";
import { hasPersonalCloudConnection, isAdmin } from "./supabase";
import { replaceAllRecords } from "./storage";

export default function AppRoot() {
  const controller = useAppController();
  const {
    access,
    isGuest,
    route,
    setRoute,
    records,
    setRecords,
    activeRecords,
    settings,
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
    dismissCloudRecoveryNotice,
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
  } = controller;
  const [layout, setLayout] = useState<ArchiveLayout>(settings.defaultView);
  const [shareMode, setShareMode] = useState(false);
  const [shareFormat, setShareFormat] = useState<ShareFormat>("adaptive-landscape");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);

  useEffect(() => {
    if (settings.defaultView && layout !== "showcase") setLayout(settings.defaultView);
  }, [settings.defaultView]);

  useEffect(() => {
    if (access.user && !isGuest && !settings.onboardingComplete) {
      void updateSettings({ ...settings, onboardingComplete: true }, "");
    }
  }, [access.user, isGuest, settings.onboardingComplete]);

  useEffect(() => {
    if (route !== "archive" && shareMode) setShareMode(false);
  }, [route, shareMode]);

  const watchedCount = activeRecords.filter((record) => effectiveStatus(record) === "watched").length;
  const cityCount = new Set(activeRecords.map((record) => record.city).filter(Boolean)).size;
  const yearCount = new Set(activeRecords.map((record) => record.date.slice(0, 4))).size;
  const archiveMediaKey = useMemo(() => activeRecords.flatMap((record) => record.media.map((asset) => `${asset.id}:${asset.src}`)).join("|"), [activeRecords]);
  const metrics = useMemo(() => {
    if (route === "archive") return [
      { value: activeRecords.length, label: "记录" },
      { value: watchedCount, label: "已看" },
      { value: cityCount, label: "城市" },
    ];
    if (route === "stats") return [
      { value: activeRecords.length, label: "记录" },
      { value: yearCount, label: "年度" },
      { value: cityCount, label: "城市" },
    ];
    return [];
  }, [activeRecords.length, cityCount, route, watchedCount, yearCount]);

  const syncLabel = isGuest
    ? "示例数据"
    : personalCloudStatus === "reconnect-needed"
      ? "个人云端需恢复"
      : syncing
        ? "同步中…"
        : syncConflicts.length
          ? `${syncConflicts.length} 条冲突`
          : hasPersonalCloudConnection(settings)
            ? "个人云端已连接"
            : "设备数据";

  const utilityActions = (
    <>
      <div className="sync-action-wrap">
        <button className={`sync-pill${syncing ? " syncing" : ""}`} type="button" aria-expanded={syncMenuOpen} onClick={() => setSyncMenuOpen((value) => !value)}>
          {syncing ? <Loader2 className="spin" /> : syncConflicts.length ? <AlertTriangle /> : <Cloud />}
          <span>{syncLabel}</span><ChevronDown />
        </button>
        {syncMenuOpen && (
          <div className="sync-action-menu" role="dialog" aria-label="云同步中心">
            <header><strong>云同步中心</strong><small>{settings.lastSyncAt ? `最近同步 ${new Date(settings.lastSyncAt).toLocaleString()}` : "尚未完成同步"}</small></header>
            <button type="button" disabled={syncing || isGuest} onClick={() => void syncNow()}><Cloud />立即同步</button>
            <button type="button" disabled={syncing || isGuest} onClick={() => void checkRemoteUpdates(false)}><CloudDownload />从云端恢复 / 检查其他设备更新</button>
            {personalCloudStatus === "reconnect-needed" && <button type="button" disabled={syncing || isGuest} onClick={() => void recoverPersonalCloud(false)}><RefreshCw />恢复个人云端</button>}
            <button type="button" disabled={syncing || isGuest || !settings.supabase.syncMedia} onClick={() => void refreshCloudMedia()}><RefreshCw />刷新云端图片</button>
            <small>{personalCloudStatus === "reconnect-needed" ? "个人云端连接尚未恢复；系统会在网页重新聚焦或恢复网络时自动重试。" : settings.supabase.syncMedia ? "图片同步已开启；网页恢复可见和网络恢复时也会自动刷新。" : "当前未开启云端图片同步。"}</small>
          </div>
        )}
      </div>
      {route === "archive" && !shareMode && (
        <>
          <button className="button ghost" type="button" onClick={() => setImportOpen(true)}><Import />导入</button>
          <button className="button primary" type="button" onClick={() => setEditing(blankRecord())}><Plus />新增</button>
        </>
      )}
    </>
  );

  return (
    <ExperienceShell
      route={route}
      onRouteChange={setRoute}
      adminVisible={!isGuest && Boolean(access.user) && isAdmin(settings)}
      accountAvatar={<AccountAvatar settings={settings} guest={isGuest} />}
      accountLabel={isGuest ? "访客" : accountLabel(settings)}
      accountSecondary={isGuest ? "临时本地" : `@${settings.account.username || "account"}`}
      accountStatus={<AccountStatus settings={settings} syncing={syncing} conflicts={syncConflicts.length} guest={isGuest} onClick={() => isGuest ? access.leaveGuest() : setRoute("settings")} />}
      metrics={metrics}
      utilityActions={utilityActions}
      shareMode={shareMode}
    >
      {cloudRecoveryNotice && !isGuest && (
        <div className="cloud-recovery-banner"><CloudDownload /><span><strong>其他设备的数据已经到达这台设备</strong><small>{cloudRecoveryNotice}</small></span><button type="button" onClick={() => void refreshCloudMedia()}>刷新图片</button><button type="button" aria-label="关闭云端恢复提示" onClick={dismissCloudRecoveryNotice}>×</button></div>
      )}
      {route === "archive" && (
        <ArchivePage
          key={archiveMediaKey}
          records={activeRecords}
          settings={settings}
          layout={layout}
          setLayout={setLayout}
          shareMode={shareMode}
          setShareMode={setShareMode}
          shareFormat={shareFormat}
          setShareFormat={setShareFormat}
          onOpen={setSelected}
          onEdit={setEditing}
          onDuplicate={(record) => {
            setSelected(null);
            setEditing(duplicateRecordForNextShow(record));
            flash("已复制为下一场：日期顺延 1 天，座位与单场图片已清空");
          }}
          onDelete={(record) => setConfirmAction({
            title: "移到回收站？",
            message: `“${record.title}”会保留在回收站，可随时恢复。`,
            confirmLabel: "移到回收站",
            danger: true,
            onConfirm: () => moveToTrash(record),
          })}
          onZoom={setZoomMedia}
          onOpenMapSettings={() => setRoute("settings")}
        />
      )}
      {route === "stats" && <StatsPage records={activeRecords} />}
      {route === "settings" && isGuest && <GuestSettingsPage onLogin={access.leaveGuest} />}
      {route === "settings" && !isGuest && (
        <SettingsPage
          settings={settings}
          records={records}
          health={health}
          busy={busy}
          setBusy={setBusy}
          setRecords={setRecords}
          onSave={updateSettings}
          onRestore={restoreRecord}
          onPermanentDelete={async (record) => {
            setConfirmAction({
              title: "永久删除这条记录？",
              message: `“${record.title}”的文字、票根和照片将从当前设备和已连接云端删除，无法恢复。`,
              confirmLabel: "永久删除",
              danger: true,
              onConfirm: () => permanentlyDeleteRecord(record),
            });
          }}
          onSignOut={access.signOutAndReturn}
          flash={flash}
        />
      )}
      {route === "admin" && !isGuest && Boolean(access.user) && isAdmin(settings) && <AdminPage settings={settings} />}

      {selected && (
        <DetailDrawer
          record={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => setConfirmAction({
            title: "移到回收站？",
            message: `“${selected.title}”会保留在回收站，可随时恢复。`,
            confirmLabel: "移到回收站",
            danger: true,
            onConfirm: () => moveToTrash(selected),
          })}
          onZoom={setZoomMedia}
          onSave={persistRecord}
        />
      )}
      {editing && <RecordEditor record={editing} onCancel={() => setEditing(null)} onSave={persistRecord} />}
      {importOpen && <ImportDrawer onClose={() => setImportOpen(false)} onSave={persistRecord} flash={flash} />}
      {zoomMedia && <ImageZoom media={zoomMedia} onClose={() => setZoomMedia(null)} />}
      {confirmAction && <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />}
      {syncConflicts.length > 0 && (
        <SyncConflictDialog
          conflicts={syncConflicts}
          settings={settings}
          onResolve={async (resolved) => {
            const resolvedMap = new Map(resolved.map((record) => [record.id, record]));
            const next = records.map((record) => resolvedMap.get(record.id) || record);
            await replaceAllRecords(next);
            setRecords(next);
            setSyncConflicts([]);
            flash("同步冲突已解决");
          }}
          onDismiss={() => setSyncConflicts([])}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </ExperienceShell>
  );
}

function AccountAvatar({ settings, guest }: { settings: AppSettings; guest: boolean }) {
  const label = guest ? "访" : accountLabel(settings).slice(0, 1).toUpperCase();
  return <span className="account-avatar">{settings.account.avatarUrl && !guest ? <img src={settings.account.avatarUrl} alt={accountLabel(settings)} /> : <b>{label}</b>}</span>;
}

function AccountStatus({ settings, syncing, conflicts, guest, onClick }: { settings: AppSettings; syncing: boolean; conflicts: number; guest: boolean; onClick: () => void }) {
  const status = guest ? "临时会话" : syncing ? "同步中…" : conflicts ? `${conflicts} 条冲突` : hasPersonalCloudConnection(settings) ? "云同步已连接" : "已登录";
  return <button className="account-chip" type="button" onClick={onClick}><AccountAvatar settings={settings} guest={guest} /><span><strong>{guest ? "访客" : accountLabel(settings)}</strong><small>{status}</small></span></button>;
}

function accountLabel(settings: AppSettings) {
  return settings.account.nickname.trim() || settings.account.username.trim() || "现场记";
}
