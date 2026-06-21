import {
  Archive,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Github,
  Heart,
  ImagePlus,
  Import,
  List,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  RotateCcw,
  X,
} from "lucide-react";
import { CSSProperties, Dispatch, FormEvent, MouseEvent, ReactNode, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  AppSettings,
  ArchiveView,
  EventCategory,
  EventRecord,
  EventStatus,
  Filters,
  ImportDraft,
  MediaAsset,
  StorageMode,
  categoryLabels,
  createId,
  daysFromToday,
  defaultSettings,
  formatDateCn,
  formatRelativeDay,
  mediaByKind,
  mediaKindLabels,
  primaryMedia,
  sourceLabels,
  splitTextList,
  statusLabels,
  validatePassword,
  validateRecoveryEmail,
  validateUsername,
  viewLabels,
} from "./domain";
import { createDraftsFromText } from "./importers";
import { downloadBlob, fileToAvatar, fileToMedia, makeMedia, nowIso } from "./media";
import { blankRecord } from "./seeds";
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
  currentUser,
  friendlySupabaseErrorMessage,
  hasAccountCloudConfig,
  hasPersonalCloudConnection,
  hasSupabaseConfig,
  pullRecordsFromSupabase,
  purgeRecordFromSupabase,
  purgeTextBackupFromAccount,
  pushTextBackupToAccount,
  pushRecordsToSupabase,
  requestPasswordReset,
  requestPasswordResetByEmail,
  refreshSignedMediaUrls,
  signInWithGithub,
  signInWithPassword,
  signInStorageWithAccount,
  signInStorageWithPassword,
  signOut,
  signUpOnly,
  syncAfterLogin,
  updateAccountPassword,
} from "./supabase";
import { withoutLocalMedia } from "./syncModel";

const emptyFilters: Filters = {
  query: "",
  categories: [],
  statuses: [],
  years: [],
  cities: [],
  artists: [],
  tags: [],
};

type Route = "archive" | "stats" | "settings";
type SortMode = "smart" | "date-desc" | "date-asc" | "price-desc" | "updated-desc";
type ConfirmAction = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
};

export default function App() {
  const [records, setRecords] = useState<EventRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [route, setRoute] = useState<Route>("archive");
  const [view, setView] = useState<ArchiveView>("poster");
  const [sort, setSort] = useState<SortMode>("smart");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [zoomMedia, setZoomMedia] = useState<MediaAsset | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadRecordsWithMigration(), Promise.resolve(readSettings())]).then(([loadedRecords, loadedSettings]) => {
      if (!mounted) return;
      setRecords(loadedRecords);
      setSettings(loadedSettings);
      setView(loadedSettings.defaultView);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const activeRecords = useMemo(() => records.filter((record) => !record.deletedAt), [records]);
  const trashRecords = useMemo(() => records.filter((record) => Boolean(record.deletedAt)), [records]);
  const facets = useMemo(() => buildFacets(activeRecords), [activeRecords]);
  const filteredRecords = useMemo(() => sortRecords(filterRecords(activeRecords, filters), sort), [activeRecords, filters, sort]);
  const health = useMemo(() => storageHealth(records, settings), [records, settings]);
  const mediaRefreshKey = useMemo(() => {
    if (!hasPersonalCloudConnection(settings) || !settings.supabase.syncMedia) return "";
    return records
      .flatMap((record) => record.media.filter((asset) => asset.storagePath).map((asset) => `${record.id}:${asset.id}:${asset.storagePath}`))
      .join("|");
  }, [records, settings]);
  const lastMediaRefreshKey = useRef("");

  useEffect(() => {
    if (!settings.onboardingComplete) return;
    if (!hasAccountCloudConfig(settings) || records.length === 0) return;
    const last = settings.accountBackup.lastBackupAt ? new Date(settings.accountBackup.lastBackupAt).getTime() : 0;
    const interval = Math.max(1, settings.accountBackup.intervalHours) * 60 * 60 * 1000;
    if (Date.now() - last < interval) return;
    const timer = window.setTimeout(() => {
      pushTextBackupToAccount(settings, records)
        .then(() => {
          const saved = writeSettings({
            ...settings,
            accountBackup: { ...settings.accountBackup, lastBackupAt: nowIso() },
          });
          setSettings(saved);
        })
        .catch(() => undefined);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [records, settings]);

  useEffect(() => {
    if (!mediaRefreshKey || mediaRefreshKey === lastMediaRefreshKey.current) return;
    if (!records.some((record) => record.media.some((asset) => asset.storagePath && !asset.src.startsWith("data:")))) return;
    lastMediaRefreshKey.current = mediaRefreshKey;
    let cancelled = false;
    refreshSignedMediaUrls(settings, records)
      .then(async (next) => {
        if (cancelled) return;
        const changed = JSON.stringify(next.map((record) => record.media.map((asset) => asset.src))) !== JSON.stringify(records.map((record) => record.media.map((asset) => asset.src)));
        if (!changed) return;
        await replaceAllRecords(next);
        setRecords(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mediaRefreshKey]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function persistRecord(record: EventRecord) {
    const saved = await saveRecord(record);
    setRecords((current) => sortRecords(current.filter((item) => item.id !== saved.id).concat(saved), "date-desc"));
    setEditing(null);
    setSelected(saved);
    flash("已保存");
  }

  async function moveToTrash(record: EventRecord) {
    const saved = await saveRecord({ ...record, deletedAt: nowIso() });
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(null);
    flash("已移入回收站");
  }

  async function restoreRecord(record: EventRecord) {
    const saved = await saveRecord({ ...record, deletedAt: undefined });
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    flash("记录已恢复");
  }

  async function permanentlyDeleteRecord(record: EventRecord) {
    if (hasAccountCloudConfig(settings)) {
      await purgeTextBackupFromAccount(settings, record.id);
    }
    if (settings.storageMode === "supabase" && hasSupabaseConfig(settings)) {
      await purgeRecordFromSupabase(settings, record.id);
    }
    await deleteRecord(record.id);
    setRecords((current) => current.filter((item) => item.id !== record.id));
    flash("记录已永久删除");
  }

  async function updateSettings(next: AppSettings) {
    const saved = writeSettings(next);
    setSettings(saved);
    setView(saved.defaultView);
    flash("设置已保存");
  }

  function updatePosterColumns(posterColumns: number) {
    const saved = writeSettings({ ...settings, posterColumns });
    setSettings(saved);
  }

  async function replaceRecords(next: EventRecord[], message: string) {
    await replaceAllRecords(next);
    setRecords(sortRecords(next, "date-desc"));
    flash(message);
  }

  const title = route === "archive" ? "档案" : route === "stats" ? "统计" : "设置";

  return (
    <div className="app">
      <aside className="rail">
        <button className="brand" type="button" onClick={() => setRoute("archive")}>
          <span className="brand-mark">演</span>
          <span>
            <strong>回响册</strong>
            <small>Live memory</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <RouteButton active={route === "archive"} icon={<Archive />} label="档案" onClick={() => setRoute("archive")} />
          <RouteButton active={route === "stats"} icon={<Sparkles />} label="统计" onClick={() => setRoute("stats")} />
          <RouteButton active={route === "settings"} icon={<Settings />} label="设置" onClick={() => setRoute("settings")} />
        </nav>
      </aside>

      <main className="workspace">
        <header className="hero">
          <div className="hero-copy">
            <p>{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</p>
            <h1>{title}</h1>
            <span className="hero-subtitle">把票根、海报、座位图和现场高光照片收进一本会呼吸的演出相册。</span>
            <div className="hero-metrics">
              <strong>{activeRecords.length}<span>场记录</span></strong>
              <strong>{activeRecords.filter((record) => record.status === "watched").length}<span>已看</span></strong>
              <strong>{new Set(activeRecords.map((record) => record.city).filter(Boolean)).size}<span>城市</span></strong>
            </div>
          </div>
          <HeroPosterWall records={activeRecords} onOpen={setSelected} />
          <div className="hero-actions">
            <AccountChip settings={settings} onClick={() => setRoute("settings")} />
            <span className="sync-pill">
              <Cloud size={16} />
              {storageLocationLabel(settings)}
            </span>
            <label className="search">
              <Search size={18} />
              <input
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="搜索艺人 / 城市 / 场馆 / 主题"
              />
            </label>
            <button className="button ghost" type="button" onClick={() => setImportOpen(true)}>
              <Import size={18} />
              导入
            </button>
            <button className="button primary" type="button" onClick={() => setEditing(blankRecord())}>
              <Plus size={18} />
              新增
            </button>
          </div>
        </header>

        {route === "archive" && (
          <>
            <FilterBar
              filters={filters}
              setFilters={setFilters}
              facets={facets}
              view={view}
              setView={setView}
              sort={sort}
              setSort={setSort}
              posterColumns={settings.posterColumns}
              setPosterColumns={updatePosterColumns}
            />
            <CountBar count={filteredRecords.length} sort={sort} />
            <ArchiveViewRenderer records={filteredRecords} view={view} posterColumns={settings.posterColumns} settings={settings} onOpen={setSelected} onZoom={setZoomMedia} onEdit={setEditing} />
          </>
        )}
        {route === "stats" && <StatsView records={filteredRecords} allRecords={activeRecords} />}
        {route === "settings" && (
          <SettingsView
            settings={settings}
            onSave={updateSettings}
            records={records}
            health={health}
            setRecords={setRecords}
            flash={flash}
            busy={busy}
            setBusy={setBusy}
            onRestore={restoreRecord}
            onPermanentDelete={(record) => setConfirmAction({
              title: "永久删除这条记录？",
              message: `"${record.title}"的文字、票根和照片将无法恢复。`,
              confirmLabel: "永久删除",
              danger: true,
              onConfirm: () => permanentlyDeleteRecord(record),
            })}
          />
        )}
      </main>

      {selected && (
        <DetailDrawer
          record={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => setConfirmAction({
            title: "移到回收站？",
            message: `"${selected.title}"会保留在回收站，可随时恢复。`,
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
      {!settings.onboardingComplete && (
        <FirstRunGuide
          settings={settings}
          records={records}
          onSave={updateSettings}
          setRecords={setRecords}
          flash={flash}
          busy={busy}
          setBusy={setBusy}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AccountChip({ settings, onClick }: { settings: AppSettings; onClick: () => void }) {
  const label = accountLabel(settings);
  const storageLabel = settings.storageMode === "supabase"
    ? hasPersonalCloudConnection(settings) ? "云同步已连接" : "云端待连接"
    : hasAccountCloudConfig(settings) ? "文字备份中" : "仅当前设备";
  return (
    <button className="account-chip" type="button" onClick={onClick}>
      <AccountAvatar settings={settings} />
      <span>
        <strong>{label}</strong>
        <small>{storageLabel}</small>
      </span>
    </button>
  );
}

function AccountAvatar({ settings }: { settings: AppSettings }) {
  const avatar = settings.account.avatarUrl.trim();
  const label = accountLabel(settings);
  return (
    <span className="account-avatar">
      {avatar ? <img src={avatar} alt={label} /> : <b>{label.slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}

function MediaImage({ media, alt, onClick }: { media: MediaAsset; alt?: string; onClick?: (event: MouseEvent<HTMLImageElement | HTMLSpanElement>) => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media.src, media.storagePath]);
  if (!media.src || failed) {
    return (
      <span className="media-fallback" onClick={onClick}>
        {media.storagePath ? "云端图片待刷新" : "图片待补"}
      </span>
    );
  }
  return <img src={media.src} alt={alt || ""} loading="lazy" onClick={onClick} onError={() => setFailed(true)} />;
}

function FirstRunGuide({
  settings,
  records,
  onSave,
  setRecords,
  flash,
  busy,
  setBusy,
}: {
  settings: AppSettings;
  records: EventRecord[];
  onSave: (settings: AppSettings) => Promise<void>;
  setRecords: (records: EventRecord[]) => void;
  flash: (message: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "skip">("login");
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const accountAvailable = hasAccountCloudConfig(draft);

  function updateAccount(patch: Partial<AppSettings["account"]>) {
    const account = { ...draft.account, ...patch };
    setDraft({ ...draft, account, supabase: patch.username !== undefined ? { ...draft.supabase, ownerKey: "" } : draft.supabase });
  }

  async function chooseAvatar(file?: File) {
    if (!file) return;
    updateAccount({ avatarUrl: await fileToAvatar(file) });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      flash(friendlySupabaseErrorMessage(error, "未完成，请检查页面设置"));
    } finally {
      setBusy(false);
    }
  }

  function complete() {
    void run(async () => {
      const username = validateUsername(draft.account.username);

      let next: AppSettings = {
        ...draft,
        account: { ...draft.account, username },
        storageMode: "local",
        onboardingComplete: true,
      };
      let message = "档案已创建";

      if (mode === "login") {
        validatePassword(password);
        const signInResult = await signInWithPassword(next, password);
        const sync = await syncAfterLogin(next, records);
        next = sync.settings;
        message = `${signInResult.message}，${sync.message}`;
        await replaceAllRecords(sync.records);
        setRecords(sync.records);
      } else if (mode === "register") {
        if (!draft.account.nickname.trim()) throw new Error("请先填写昵称");
        validatePassword(password);
        if (draft.account.recoveryEmail) validateRecoveryEmail(draft.account.recoveryEmail);
        const signUpResult = await signUpOnly(next, password);
        const sync = await syncAfterLogin(next, records);
        next = sync.settings;
        message = `${signUpResult.message}，${sync.message}`;
        await replaceAllRecords(sync.records);
        setRecords(sync.records);
      } else {
        if (!draft.account.nickname.trim()) throw new Error("请先填写昵称");
      }

      await onSave(next);
      flash(message);
    });
  }

  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <div className="onboarding-copy">
          <span>欢迎使用</span>
          <h2 id="first-run-title">{accountAvailable ? "登录、注册或本地使用" : "开始记录你的现场回忆"}</h2>
          <p>{accountAvailable
            ? "登录已有账号同步数据，创建新账号开始云端记录，或先在本地体验。"
            : "设置你的昵称和用户名，开始记录你的演出回忆。"}</p>
        </div>

        {accountAvailable && (
          <div className="onboarding-choice-row">
            <button className={`storage-choice${mode === "login" ? " is-active" : ""}`} type="button" onClick={() => { setMode("login"); setPassword(""); setShowReset(false); }}>
              <span>01</span>
              <strong>登录已有账号</strong>
              <em>输入用户名和密码登录，自动同步云端数据。</em>
            </button>
            <button className={`storage-choice${mode === "register" ? " is-active" : ""}`} type="button" onClick={() => { setMode("register"); setPassword(""); setShowReset(false); }}>
              <span>02</span>
              <strong>创建新账号</strong>
              <em>第一次使用？创建账号，数据自动同步到云端。</em>
            </button>
            <button className={`storage-choice${mode === "skip" ? " is-active" : ""}`} type="button" onClick={() => { setMode("skip"); setShowReset(false); }}>
              <span>03</span>
              <strong>先在本地体验</strong>
              <em>暂不注册，数据仅保存在当前设备浏览器中。</em>
            </button>
          </div>
        )}

        {mode === "login" && (
          <div className="onboarding-form onboarding-login-form">
            <label className="field">用户名<input value={draft.account.username} onChange={(event) => updateAccount({ username: cleanUsernameInput(event.target.value) })} placeholder="注册时使用的用户名" autoCapitalize="none" autoFocus /></label>
            <label className="field">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" autoFocus={!!draft.account.username} /></label>
          </div>
        )}

        {mode === "register" && (
          <div className="onboarding-form">
            <div className="account-preview">
              <AccountAvatar settings={draft} />
              <p>用户名用于登录，昵称和头像显示在页面右上角。</p>
            </div>
            <label className="field">昵称<input value={draft.account.nickname} onChange={(event) => updateAccount({ nickname: event.target.value })} placeholder="例如：Qi" /></label>
            <label className="field">用户名<input value={draft.account.username} onChange={(event) => updateAccount({ username: cleanUsernameInput(event.target.value) })} placeholder="4-32 位英文字母或数字" autoCapitalize="none" /></label>
            <label className="field avatar-upload-field">头像（可选）<span className="file-picker"><ImagePlus size={18} />{draft.account.avatarUrl ? "更换头像" : "选择图片"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseAvatar(event.target.files?.[0])} /></span></label>
            <label className="field">找回邮箱（可选）<input type="email" value={draft.account.recoveryEmail} onChange={(event) => updateAccount({ recoveryEmail: event.target.value })} placeholder="用于找回密码" /></label>
            <label className="field">设置密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位，字符不限" /></label>
          </div>
        )}

        {mode === "skip" && (
          <div className="onboarding-form onboarding-skip-form">
            <label className="field">昵称<input value={draft.account.nickname} onChange={(event) => updateAccount({ nickname: event.target.value })} placeholder="例如：Qi" autoFocus /></label>
            <label className="field">用户名（可选）<input value={draft.account.username} onChange={(event) => updateAccount({ username: cleanUsernameInput(event.target.value) })} placeholder="4-32 位英文字母或数字" autoCapitalize="none" /></label>
          </div>
        )}

        {mode === "login" && (
          <div className="onboarding-forgot">
            {!showReset ? (
              <button className="button-link" type="button" onClick={() => setShowReset(true)}>忘记密码？</button>
            ) : (
              <div className="onboarding-reset-row">
                <input type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} placeholder="输入你注册时填写的邮箱" />
                <button className="button ghost" type="button" disabled={busy || !resetEmail.trim()} onClick={() => void run(async () => {
                  const msg = await requestPasswordResetByEmail(resetEmail);
                  flash(msg);
                  setShowReset(false);
                })}>发送重置邮件</button>
              </div>
            )}
          </div>
        )}

        {accountAvailable && mode === "register" && <p className="plain-hint">{draft.account.recoveryEmail ? "找回邮箱用于接收密码找回邮件。" : "不填邮箱也能使用；但忘记密码后将无法找回账号。"}</p>}

        <div className="onboarding-actions">
          {mode === "skip" && (
            <button className="button primary" type="button" disabled={busy} onClick={complete}>
              {busy ? <Loader2 className="spin" /> : <Sparkles size={18} />}
              开始使用
            </button>
          )}
          {mode === "login" && (
            <button className="button primary" type="button" disabled={busy || !password} onClick={complete}>
              {busy ? <Loader2 className="spin" /> : <ShieldCheck size={18} />}
              登录
            </button>
          )}
          {mode === "register" && (
            <button className="button primary" type="button" disabled={busy || !password} onClick={complete}>
              {busy ? <Loader2 className="spin" /> : <ShieldCheck size={18} />}
              创建账号
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function RouteButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`route ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function HeroPosterWall({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const picks = records.filter((record) => primaryMedia(record)).slice(0, 7);
  if (!picks.length) {
    return (
      <div className="hero-poster-wall is-empty" aria-hidden="true">
        <span>LIVE</span>
        <span>MEMORY</span>
        <span>TICKET</span>
      </div>
    );
  }
  return (
    <div className="hero-poster-wall" aria-label="演出海报精选">
      {picks.map((record, index) => {
        const media = primaryMedia(record);
        return (
          <button className={`hero-poster hero-poster-${index + 1}`} key={record.id} type="button" onClick={() => onOpen(record)}>
            {media && <MediaImage media={media} alt={record.title} />}
            <span>{record.city || categoryLabels[record.category]}</span>
          </button>
        );
      })}
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  facets,
  view,
  setView,
  sort,
  setSort,
  posterColumns,
  setPosterColumns,
}: {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  facets: ReturnType<typeof buildFacets>;
  view: ArchiveView;
  setView: (value: ArchiveView) => void;
  sort: SortMode;
  setSort: (value: SortMode) => void;
  posterColumns: number;
  setPosterColumns: (value: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = filters.categories.length + filters.statuses.length + filters.years.length + filters.cities.length + filters.artists.length + filters.tags.length;
  const clearFilters = () => setFilters((current) => ({ ...emptyFilters, query: current.query }));
  return (
    <section className="toolbar">
      <div className="toolbar-compact">
        <div>
          <span className="toolbar-kicker">筛选</span>
          <strong>{activeCount ? `${activeCount} 组条件生效` : "未展开高级筛选"}</strong>
        </div>
        <div className="toolbar-compact-actions">
          {activeCount > 0 && <button className="button ghost compact-button" type="button" onClick={clearFilters}>清空</button>}
          <button className="button primary compact-button" type="button" onClick={() => setExpanded((value) => !value)}>
            <Filter size={16} />
            {expanded ? "收起" : "筛选"}
          </button>
        </div>
      </div>
      <div className={`filter-clusters ${expanded ? "is-open" : ""}`}>
        <MultiSelect label="类型" values={filters.categories} options={facets.categories} labels={categoryLabels} onChange={(categories) => setFilters((current) => ({ ...current, categories }))} />
        <MultiSelect label="状态" values={filters.statuses} options={facets.statuses} labels={statusLabels} onChange={(statuses) => setFilters((current) => ({ ...current, statuses }))} />
        <ChipGroup label="年份" values={filters.years} options={facets.years} onChange={(years) => setFilters((current) => ({ ...current, years }))} />
        <ChipGroup label="城市" values={filters.cities} options={facets.cities} onChange={(cities) => setFilters((current) => ({ ...current, cities }))} />
        <ChipGroup label="艺人" values={filters.artists} options={facets.artists} onChange={(artists) => setFilters((current) => ({ ...current, artists }))} />
      </div>
      <div className={`toolbar-row ${view === "poster" ? "has-columns" : ""}`}>
        <label className="select-wrap">
          <span>排序</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="smart">智能排序</option>
            <option value="date-desc">时间最新</option>
            <option value="date-asc">时间最早</option>
            <option value="price-desc">票价最高</option>
            <option value="updated-desc">最近编辑</option>
          </select>
        </label>
        {view === "poster" && (
          <label className="select-wrap compact-select">
            <span>每行</span>
            <select value={posterColumns} onChange={(event) => setPosterColumns(Number(event.target.value))}>
              {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 张</option>)}
            </select>
          </label>
        )}
        <div className="view-switch" aria-label="展示方式">
          {(Object.keys(viewLabels) as ArchiveView[]).map((item) => (
            <button className={view === item ? "is-active" : ""} key={item} type="button" onClick={() => setView(item)}>
              {viewIcon(item)}
              <span>{viewLabels[item]}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function MultiSelect<T extends string>({
  label,
  values,
  options,
  labels,
  onChange,
}: {
  label: string;
  values: T[];
  options: T[];
  labels: Record<T, string>;
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="chip-set">
      <span>{label}</span>
      <button className={!values.length ? "is-active" : ""} type="button" onClick={() => onChange([])}>
        全部
      </button>
      {options.map((option) => (
        <button
          className={values.includes(option) ? "is-active" : ""}
          key={option}
          type="button"
          onClick={() => onChange(toggleValue(values, option))}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function ChipGroup({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (values: string[]) => void }) {
  if (!options.length) return null;
  return (
    <div className="chip-set">
      <span>{label}</span>
      <button className={!values.length ? "is-active" : ""} type="button" onClick={() => onChange([])}>
        全部
      </button>
      {options.slice(0, 8).map((option) => (
        <button
          className={values.includes(option) ? "is-active" : ""}
          key={option}
          type="button"
          onClick={() => onChange(toggleValue(values, option))}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function CountBar({ count, sort }: { count: number; sort: SortMode }) {
  return (
    <section className="count-bar">
      <span>演出</span>
      <strong>{count}</strong>
      <em>排序：{sort === "smart" ? "智能排序" : sort === "date-desc" ? "时间最新" : sort === "date-asc" ? "时间最早" : sort === "price-desc" ? "票价最高" : "最近编辑"}</em>
    </section>
  );
}

function ArchiveViewRenderer({
  records,
  view,
  posterColumns,
  settings,
  onOpen,
  onZoom,
  onEdit,
}: {
  records: EventRecord[];
  view: ArchiveView;
  posterColumns: number;
  settings: AppSettings;
  onOpen: (record: EventRecord) => void;
  onZoom: (asset: MediaAsset) => void;
  onEdit: (record: EventRecord) => void;
}) {
  if (!records.length) return <EmptyState />;
  if (view === "price") return <PriceView records={records} onOpen={onOpen} />;
  if (view === "timeline") return <TimelineView records={records} onOpen={onOpen} />;
  if (view === "summary") return <SummaryView records={records} />;
  if (view === "calendar") return <CalendarView records={records} onOpen={onOpen} />;
  if (view === "venue") return <VenueView records={records} settings={settings} />;
  if (view === "list") return <ListView records={records} onOpen={onOpen} />;
  if (view === "ticket") return <TicketView records={records} onOpen={onOpen} />;
  const gridStyle = {
    "--poster-columns": posterColumns,
    "--poster-mobile-columns": Math.min(3, posterColumns),
  } as CSSProperties;
  return (
    <section className={view === "poster" ? "poster-grid" : "wallet-list"} style={view === "poster" ? gridStyle : undefined}>
      {records.map((record, index) =>
        view === "wallet" ? (
          <WalletCard record={record} key={record.id} onOpen={onOpen} onZoom={onZoom} onEdit={onEdit} />
        ) : (
          <PosterCard compact={view === "poster"} index={index} record={record} key={record.id} onOpen={onOpen} onZoom={onZoom} />
        ),
      )}
    </section>
  );
}

function PosterCard({ record, index, compact, onOpen, onZoom }: { record: EventRecord; index: number; compact: boolean; onOpen: (record: EventRecord) => void; onZoom: (asset: MediaAsset) => void }) {
  const poster = primaryMedia(record);
  return (
    <article className={`poster-card ${compact ? "is-compact" : ""}`} onClick={() => onOpen(record)}>
      <button className="rank" type="button" aria-label={`第 ${index + 1} 条`}>
        #{String(index + 1).padStart(2, "0")}
      </button>
      <div className="poster-frame" style={{ background: `linear-gradient(135deg, ${record.colors[0]}, ${record.colors[1]})` }}>
        {poster ? <MediaImage media={poster} alt={record.title} onClick={(event) => { event.stopPropagation(); onZoom(poster); }} /> : <span>{record.title.slice(0, 4)}</span>}
      </div>
      <div className="poster-info">
        <div className="meta-row">
          <span className="badge">{categoryLabels[record.category]}</span>
          <span>{statusLabels[record.status]}</span>
        </div>
        <h3>{record.title}</h3>
        {!compact && <p>{record.artists.join(" / ") || "艺人待补"}</p>}
        <dl>
          <dt>日期</dt>
          <dd>{formatDateCn(record.date, record.time)}</dd>
          <dt>场馆</dt>
          <dd>{record.city} · {record.venue || "场馆待补"}</dd>
          <dt>票价</dt>
          <dd>{record.price ? `¥${record.price}` : record.publicPriceRange || "未填票价"}</dd>
        </dl>
      </div>
    </article>
  );
}

function WalletCard({ record, onOpen, onZoom, onEdit }: { record: EventRecord; onOpen: (record: EventRecord) => void; onZoom: (asset: MediaAsset) => void; onEdit: (record: EventRecord) => void }) {
  const poster = primaryMedia(record);
  return (
    <article className="wallet-card" style={{ "--tone-a": record.colors[0], "--tone-b": record.colors[1] } as CSSProperties}>
      <button className="cover-button" type="button" onClick={() => (poster ? onZoom(poster) : onOpen(record))}>
        {poster ? <MediaImage media={poster} alt={record.title} /> : <span>{record.title.slice(0, 3)}</span>}
      </button>
      <div className="wallet-main">
        <button className="wallet-open" type="button" onClick={() => onOpen(record)}>
          <span className="wallet-meta-line">
            <span className="wallet-kind">{categoryLabels[record.category]}</span>
            <span className={`status-pill ${statusClass(record.status)}`}>{statusLabels[record.status]}</span>
          </span>
          <h3>{record.title}</h3>
          <p className="wallet-artist">{record.artists.join(" / ") || "艺人待补"}</p>
          <dl className="wallet-facts">
            <dt>日期</dt>
            <dd>{formatDateCn(record.date, record.time)}</dd>
            <dt>场馆</dt>
            <dd>{record.city || "城市待补"} · {record.venue || "场馆待补"}</dd>
            <dt>票座</dt>
            <dd>{record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"} · {record.seat || "座位待补"}</dd>
          </dl>
          <strong>{formatRelativeDay(record.date)}</strong>
        </button>
      </div>
      <div className="card-actions">
        <IconButton label="打开" onClick={() => onOpen(record)} icon={<Eye />} />
        <IconButton label="编辑" onClick={() => onEdit(record)} icon={<Pencil />} />
      </div>
    </article>
  );
}

function TicketView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return (
    <section className="ticket-grid">
      {records.map((record) => {
        const poster = primaryMedia(record);
        return (
          <button className="memory-ticket" key={record.id} type="button" onClick={() => onOpen(record)}>
            <div className="ticket-poster">{poster ? <MediaImage media={poster} alt={record.title} /> : <span>{record.title.slice(0, 2)}</span>}</div>
            <div className="ticket-copy">
              <span>{categoryLabels[record.category]}</span>
              <h3>{record.title}</h3>
              <p>{record.artists.join(" / ") || "艺人待补"}</p>
              <dl>
                <dt>日期</dt>
                <dd>{record.date}</dd>
                <dt>场馆</dt>
                <dd>{record.city} · {record.venue}</dd>
                <dt>座位</dt>
                <dd>{record.seat || "座位待补"}</dd>
              </dl>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function PriceView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const priced = [...records].sort((a, b) => (b.price || 0) - (a.price || 0));
  const filledPrices = priced.filter((item) => item.price);
  const average = Math.round(priced.reduce((sum, item) => sum + (item.price || 0), 0) / Math.max(1, filledPrices.length));
  const maxPrice = Math.max(1, ...priced.map((item) => item.price || 0));
  return (
    <section className="price-board">
      <div className="metric-strip">
        <Metric title="记录" value={records.length} hint="当前筛选" />
        <Metric title="已看" value={records.filter((item) => item.status === "watched").length} hint="完成观演" light />
        <Metric title="城市" value={new Set(records.map((item) => item.city).filter(Boolean)).size} hint="足迹" />
        <Metric title="均价" value={`¥${average || 0}`} hint="按已填票价" light />
      </div>
      <div className="price-table">
        <div className="price-head">
          <span>排序</span>
          <span>演出</span>
          <span>票价进度</span>
          <span>座位</span>
        </div>
        {priced.map((record, index) => (
          <button className="price-row" key={record.id} type="button" onClick={() => onOpen(record)}>
            <span className="price-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="price-title">{record.title}<em>{record.artists.join(" / ") || "艺人待补"} · {record.date} · {record.city}</em></span>
            <span className="price-meter" style={{ "--price-ratio": `${Math.max(6, Math.round(((record.price || 0) / maxPrice) * 100))}%` } as CSSProperties}>
              <i />
              <strong>{record.price ? `¥${record.price}` : record.publicPriceRange || "待补"}</strong>
            </span>
            <span>{record.seat || "座位待补"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TimelineView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const ordered = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date)), [records]);
  const years = useMemo(() => unique(ordered.map((record) => record.date.slice(0, 4))).sort((a, b) => b.localeCompare(a)), [ordered]);
  const [yearIndex, setYearIndex] = useState(0);
  const yearRefs = useRef<Record<string, HTMLDivElement | null>>({});
  function jumpToYear(index: number) {
    const nextIndex = Math.min(years.length - 1, Math.max(0, index));
    setYearIndex(nextIndex);
    yearRefs.current[years[nextIndex]]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <div className="timeline-shell">
      <aside className="timeline-rail" aria-label="年份快速定位">
        <strong>{years[yearIndex] || "时间"}</strong>
        <input
          aria-label="拖动定位年份"
          max={Math.max(0, years.length - 1)}
          min={0}
          onChange={(event) => jumpToYear(Number(event.target.value))}
          type="range"
          value={yearIndex}
        />
        <div>
          {years.map((year, index) => (
            <button className={index === yearIndex ? "is-active" : ""} key={year} type="button" onClick={() => jumpToYear(index)}>
              {year}
            </button>
          ))}
        </div>
      </aside>
      <div className="timeline">
        {years.map((year) => (
          <div className="timeline-year" key={year} ref={(node) => { yearRefs.current[year] = node; }}>
            <h2>{year}</h2>
            {ordered.filter((record) => record.date.startsWith(year)).map((record) => {
              const poster = primaryMedia(record);
              return (
                <button className="timeline-item" key={record.id} type="button" onClick={() => onOpen(record)}>
                  <time>
                    <span>{record.date.slice(0, 4)}</span>
                    <strong>{record.date.slice(5).replace("-", ".")}</strong>
                  </time>
                  <div className="timeline-thumb">{poster ? <MediaImage media={poster} alt="" /> : <Ticket />}</div>
                  <div>
                    <span className="timeline-type">{categoryLabels[record.category]}</span>
                    <h3>{record.title}</h3>
                    <p>{record.artists.join(" / ")} · {record.city} · {record.venue}</p>
                    <small>{record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"} · {record.seat || "座位待补"}</small>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

type AMapNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => AMapInstance;
  Marker: new (options: Record<string, unknown>) => unknown;
  Geocoder?: new (options: Record<string, unknown>) => AMapGeocoder;
  Pixel?: new (x: number, y: number) => unknown;
};

type AMapInstance = {
  add: (items: unknown[]) => void;
  setFitView: (items?: unknown[], immediately?: boolean, padding?: number[]) => void;
  destroy: () => void;
};

type AMapGeocoder = {
  getLocation: (address: string, callback: (status: string, result: AMapGeocoderResult) => void) => void;
};

type AMapGeocoderResult = {
  geocodes?: Array<{
    location?: {
      lng: number;
      lat: number;
    };
  }>;
};

type MapPoint = {
  lng: number;
  lat: number;
  title: string;
  count: number;
};

type VenueMapMode = "city" | "venue";

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
    __liveMemoryAmapPromise?: Promise<AMapNamespace>;
  }
}

function SummaryView({ records }: { records: EventRecord[] }) {
  const artistRows = topRows(records.flatMap((record) => record.artists));
  const cityRows = topRows(records.map((record) => record.city).filter(Boolean));
  const tagRows = topRows(records.flatMap((record) => record.tags));
  return (
    <section className="summary-grid">
      <SummaryPanel title="常看艺人" rows={artistRows} />
      <SummaryPanel title="城市足迹" rows={cityRows} />
      <SummaryPanel title="标签热度" rows={tagRows} />
    </section>
  );
}

function SummaryPanel({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <div className="panel summary-panel">
      <h2>{title}</h2>
      {rows.map(([label, value]) => (
        <div className="bar-row" key={label}>
          <span>{label}</span>
          <div><i style={{ width: `${(value / max) * 100}%` }} /></div>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function CalendarView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  const groups = groupBy(records, (record) => record.date.slice(0, 7));
  return (
    <section className="calendar-list">
      {Object.entries(groups).map(([month, items]) => (
        <div className="month-block" key={month}>
          <h2>{month.replace("-", " / ")}</h2>
          <div>
            {items.map((record) => (
              <button key={record.id} type="button" onClick={() => onOpen(record)}>
                <strong>{record.date.slice(8)}</strong>
                <span>{record.title}</span>
                <em>{record.city}</em>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function VenueView({ records, settings }: { records: EventRecord[]; settings: AppSettings }) {
  const [mapMode, setMapMode] = useState<VenueMapMode>("city");
  const modeLabel = mapMode === "city" ? "城市" : "场馆";
  const rows = useMemo(
    () => mapMode === "city"
      ? topRows(records.map((record) => record.city).filter(Boolean), 24)
      : topRows(records.map(formatVenueLabel).filter(Boolean), 24),
    [mapMode, records],
  );
  const maxRowCount = Math.max(1, ...rows.map(([, count]) => count));
  const mapRef = useRef<HTMLDivElement | null>(null);
  const activeProvider = settings.map.provider === "none" && settings.map.amapKey.trim() ? "amap" : settings.map.provider;
  const [mapState, setMapState] = useState(activeProvider === "amap" ? "地图准备中" : "未启用真实地图");

  useEffect(() => {
    let cancelled = false;
    let map: AMapInstance | null = null;

    async function drawMap() {
      if (activeProvider !== "amap") {
        setMapState("选择高德地图并保存后加载真实底图");
        return;
      }
      const key = settings.map.amapKey.trim();
      if (!key) {
        setMapState("请先在设置里填写高德地图密钥");
        return;
      }
      if (!mapRef.current) return;
      try {
        setMapState("正在加载高德地图");
        const AMap = await loadAmap(key, settings.map.amapSecurityCode.trim());
        if (cancelled || !mapRef.current) return;
        const points = await resolveMapPoints(AMap, records, mapMode);
        if (cancelled || !mapRef.current) return;
        map = new AMap.Map(mapRef.current, {
          center: [104.195397, 35.86166],
          zoom: 4.2,
          mapStyle: "amap://styles/normal",
          resizeEnable: true,
        });
        const markers = points.map((point) => new AMap.Marker({
          position: [point.lng, point.lat],
          title: `${point.title} · ${point.count} 场`,
          label: {
            content: `<span class="amap-memory-label">${point.title}<b>${point.count}</b></span>`,
            direction: "top",
          },
        }));
        if (markers.length) {
          map.add(markers);
          map.setFitView(markers, false, [72, 72, 72, 72]);
        }
        setMapState(markers.length ? `已按${modeLabel}显示 ${markers.length} 个点位` : `没有可定位的${modeLabel}`);
      } catch (error) {
        setMapState(error instanceof Error ? error.message : "地图加载失败");
      }
    }

    void drawMap();
    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [activeProvider, mapMode, modeLabel, records, settings.map.amapKey, settings.map.amapSecurityCode]);

  return (
    <section className="venue-view">
      <div className="map-stage">
        <div className="venue-mode-bar" aria-label="地图整理方式">
          <span>整理方式</span>
          <button className={mapMode === "city" ? "is-active" : ""} type="button" onClick={() => setMapMode("city")}>城市</button>
          <button className={mapMode === "venue" ? "is-active" : ""} type="button" onClick={() => setMapMode("venue")}>场馆</button>
        </div>
        <div className="map-canvas" ref={mapRef}>
          {activeProvider !== "amap" && (
            <div className="map-fallback">
              <MapIcon size={28} />
              <h2>全国足迹</h2>
              <p>{settings.map.provider === "baidu" ? "切换到高德地图可查看带城市标记的真实底图。" : "在设置中选择地图来源并保存密钥，即可查看城市与场馆足迹。"}</p>
              <div className="city-cloud">
                {rows.map(([label, count]) => (
                  <span key={label} style={{ "--size": `${Math.min(2.2, 1 + count / 4)}rem` } as CSSProperties}>
                    {label}<b>{count}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="map-status">{mapState}</p>
      </div>
      <div className="panel venue-list">
        <header className="venue-list-head">
          <span>按{modeLabel}</span>
          <h2>{mapMode === "city" ? "常去城市" : "常去场馆"}</h2>
        </header>
        {rows.map(([label, count]) => (
          <p key={label} style={{ "--venue-ratio": `${Math.max(8, (count / maxRowCount) * 100)}%` } as CSSProperties}>
            <span>{label}</span>
            <b>{count}</b>
          </p>
        ))}
      </div>
    </section>
  );
}

function loadAmap(key: string, securityCode: string) {
  if (typeof window === "undefined") return Promise.reject(new Error("当前环境不能加载地图"));
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
  if (window.__liveMemoryAmapPromise) return window.__liveMemoryAmapPromise;
  window.__liveMemoryAmapPromise = new Promise<AMapNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.liveMemoryAmap = "true";
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`;
    script.onload = () => {
      if (window.AMap?.Map) resolve(window.AMap);
      else reject(new Error("高德地图脚本已加载，但地图对象不可用"));
    };
    script.onerror = () => reject(new Error("高德地图加载失败，请检查 Key、服务绑定和网络"));
    document.head.appendChild(script);
  }).catch((error) => {
    window.__liveMemoryAmapPromise = undefined;
    throw error;
  });
  return window.__liveMemoryAmapPromise;
}

async function resolveMapPoints(AMap: AMapNamespace, records: EventRecord[], mode: VenueMapMode) {
  const grouped = new Map<string, { title: string; count: number; address: string; fallback?: [number, number] }>();
  for (const record of records) {
    const title = mode === "city" ? record.city : formatVenueLabel(record);
    if (!title) continue;
    const key = mode === "city" ? record.city : `${record.city}|${record.venue || record.address}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    const fallback = mode === "city" ? cityLngLat(record.city) : record.coordinates ? [record.coordinates.lng, record.coordinates.lat] as [number, number] : cityLngLat(record.city);
    grouped.set(key, {
      title,
      count: 1,
      address: mode === "city" ? record.city : [record.city, record.address, record.venue].filter(Boolean).join(" "),
      fallback,
    });
  }
  const points: MapPoint[] = [];
  const geocoder = AMap.Geocoder ? new AMap.Geocoder({ city: "全国" }) : null;
  for (const item of Array.from(grouped.values()).slice(0, 80)) {
    const resolved = item.fallback || (geocoder ? await geocodeAddress(geocoder, item.address) : undefined);
    if (!resolved) continue;
    points.push({ title: item.title, count: item.count, lng: resolved[0], lat: resolved[1] });
  }
  return points;
}

function formatVenueLabel(record: EventRecord) {
  const venue = record.venue?.trim();
  if (!venue) return record.city?.trim() || "";
  return record.city ? `${record.city} · ${venue}` : venue;
}

function geocodeAddress(geocoder: AMapGeocoder, address: string) {
  return new Promise<[number, number] | undefined>((resolve) => {
    if (!address.trim()) {
      resolve(undefined);
      return;
    }
    geocoder.getLocation(address, (status, result) => {
      const location = status === "complete" ? result.geocodes?.[0]?.location : undefined;
      resolve(location ? [location.lng, location.lat] : undefined);
    });
  });
}

function cityLngLat(city: string): [number, number] | undefined {
  const normalized = city.replace(/市$/, "").trim();
  const centers: Record<string, [number, number]> = {
    北京: [116.4074, 39.9042],
    上海: [121.4737, 31.2304],
    广州: [113.2644, 23.1291],
    深圳: [114.0579, 22.5431],
    杭州: [120.1551, 30.2741],
    南京: [118.7969, 32.0603],
    苏州: [120.5853, 31.2989],
    成都: [104.0665, 30.5723],
    重庆: [106.5516, 29.563],
    武汉: [114.3055, 30.5928],
    郑州: [113.6254, 34.7466],
    洛阳: [112.454, 34.6197],
    西安: [108.9398, 34.3416],
    长沙: [112.9388, 28.2282],
    厦门: [118.0894, 24.4798],
    福州: [119.2965, 26.0745],
    青岛: [120.3826, 36.0671],
    济南: [117.1201, 36.6512],
    天津: [117.2009, 39.0842],
    沈阳: [123.4315, 41.8057],
    大连: [121.6147, 38.914],
    哈尔滨: [126.6424, 45.756],
    合肥: [117.2272, 31.8206],
    南昌: [115.8582, 28.6829],
    昆明: [102.8329, 24.8801],
    贵阳: [106.6302, 26.647],
    南宁: [108.3669, 22.817],
    海口: [110.1983, 20.044],
    三亚: [109.5119, 18.2528],
    乌鲁木齐: [87.6168, 43.8256],
    呼和浩特: [111.7492, 40.8426],
    银川: [106.2309, 38.4872],
    兰州: [103.8343, 36.0611],
    西宁: [101.7782, 36.6171],
    拉萨: [91.1322, 29.6604],
    太原: [112.5489, 37.8706],
    石家庄: [114.5149, 38.0428],
    宁波: [121.5503, 29.8746],
    温州: [120.6994, 27.9943],
    无锡: [120.3124, 31.4909],
    常州: [119.9737, 31.8107],
  };
  return centers[normalized];
}

function ListView({ records, onOpen }: { records: EventRecord[]; onOpen: (record: EventRecord) => void }) {
  return (
    <section className="list-view">
      {records.map((record) => (
        <button key={record.id} type="button" onClick={() => onOpen(record)}>
          <span>{record.date}</span>
          <strong>{record.title}</strong>
          <em>{record.artists.join(" / ")}</em>
          <span>{record.city} · {record.venue}</span>
          <b>{record.price ? `¥${record.price}` : "待补"}</b>
        </button>
      ))}
    </section>
  );
}

function StatsView({ records, allRecords }: { records: EventRecord[]; allRecords: EventRecord[] }) {
  const watched = allRecords.filter((record) => record.status === "watched");
  const future = allRecords.filter((record) => record.status !== "watched");
  const totalPrice = watched.reduce((sum, record) => sum + (record.price || 0), 0);
  return (
    <section className="stats">
      <div className="metric-strip">
        <Metric title="总记录" value={allRecords.length} hint="全部档案" />
        <Metric title="已看" value={watched.length} hint="完成观演" light />
        <Metric title="待看" value={future.length} hint="未来计划" />
        <Metric title="总票价" value={`¥${totalPrice}`} hint="按已填票价" light />
      </div>
      <SummaryView records={records} />
    </section>
  );
}

function SettingsView({
  settings,
  onSave,
  records,
  health,
  setRecords,
  flash,
  busy,
  setBusy,
  onRestore,
  onPermanentDelete,
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  records: EventRecord[];
  health: ReturnType<typeof storageHealth>;
  setRecords: (records: EventRecord[]) => void;
  flash: (message: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onRestore: (record: EventRecord) => Promise<void>;
  onPermanentDelete: (record: EventRecord) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [password, setPassword] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [userLabel, setUserLabel] = useState("未登录");
  const [accountSignedIn, setAccountSignedIn] = useState(false);
  const [showCloudMore, setShowCloudMore] = useState(false);
  const [showCloudReconnect, setShowCloudReconnect] = useState(false);
  const [showMapMore, setShowMapMore] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const accountAvailable = hasAccountCloudConfig(draft);
  useEffect(() => {
    let alive = true;
    if (!hasAccountCloudConfig(settings)) {
      setUserLabel("未连接");
      setAccountSignedIn(false);
      return () => {
        alive = false;
      };
    }
    currentUser(settings)
      .then((user) => {
        if (alive) {
          setUserLabel(userDisplayName(user));
          setAccountSignedIn(Boolean(user));
        }
      })
      .catch(() => {
        if (alive) {
          setUserLabel("未登录");
          setAccountSignedIn(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [settings.supabase.url, settings.supabase.anonKey, settings.account.username, settings.account.recoveryEmail]);
  const syncSelected = draft.storageMode === "supabase";
  const syncReady = syncSelected && hasSupabaseConfig(draft);
  const syncConnected = syncSelected && hasPersonalCloudConnection(draft);
  const showCloudConnectPanel = syncSelected && (!syncConnected || showCloudReconnect);
  const needsCloudPassword = showCloudConnectPanel && !accountSignedIn;
  const trashRecords = records.filter((r) => r.deletedAt);

  async function importJson(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(rows)) throw new Error("备份文件格式不正确");
    await replaceAllRecords(rows as EventRecord[]);
    setRecords(rows as EventRecord[]);
    flash(`已导入 ${rows.length} 条记录`);
  }

  function chooseStorageMode(storageMode: AppSettings["storageMode"]) {
    const next = { ...draft, storageMode };
    setDraft(next);
    void onSave(next);
  }

  function updateAccount(patch: Partial<AppSettings["account"]>) {
    const account = { ...draft.account, ...patch };
    setDraft({ ...draft, account, supabase: patch.username !== undefined ? { ...draft.supabase, ownerKey: "" } : draft.supabase });
    if (patch.username !== undefined) setShowCloudReconnect(true);
  }

  function updateSupabaseConfig(patch: Partial<AppSettings["supabase"]>, reconnect = false) {
    setDraft({
      ...draft,
      supabase: {
        ...draft.supabase,
        ...patch,
        ownerKey: reconnect ? "" : draft.supabase.ownerKey,
      },
    });
    if (reconnect) setShowCloudReconnect(true);
  }

  async function chooseAvatar(file?: File) {
    if (!file) return;
    try {
      updateAccount({ avatarUrl: await fileToAvatar(file) });
    } catch (error) {
      flash(error instanceof Error ? error.message : "头像处理失败");
    }
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      if (label) flash(label);
    } catch (error) {
      flash(friendlySupabaseErrorMessage(error, "未完成，请检查页面设置"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAccountLogin() {
    const next = {
      ...draft,
      account: {
        ...draft.account,
        username: validateUsername(draft.account.username),
        recoveryEmail: validateRecoveryEmail(draft.account.recoveryEmail),
      },
    };
    validatePassword(password);
    await onSave(next);
    const signInResult = await signInWithPassword(next, password);
    const sync = await syncAfterLogin(next, records);
    setDraft(sync.settings);
    await onSave(sync.settings);
    await replaceAllRecords(sync.records);
    setRecords(sync.records);
    const user = await currentUser(sync.settings);
    if (user) setUserLabel(userDisplayName(user));
    setAccountSignedIn(Boolean(user));
    flash(`${signInResult.message}，${sync.message}`);
  }

  async function handleConnectCloud() {
    validateUsername(draft.account.username);
    const connected = accountSignedIn
      ? await signInStorageWithAccount(draft)
      : await signInStorageWithPassword(draft, cloudPassword);
    setDraft(connected.settings);
    setCloudPassword("");
    setShowCloudReconnect(false);
    await onSave(connected.settings);
    flash(connected.message);
  }

  async function handleUploadToCloud() {
    const result = await pushRecordsToSupabase(draft, records);
    setRecords(result.records);
    await onSave({ ...draft, lastSyncAt: nowIso() });
  }

  async function handleRestoreFromCloud() {
    const result = await pullRecordsFromSupabase(draft, records);
    await replaceAllRecords(result.records);
    setRecords(result.records);
    await onSave({ ...draft, lastSyncAt: nowIso() });
  }

  return (
    <section className="settings-page">
      <div className="settings-masonry">
        <div className="settings-col-main">
          <section className="panel account-settings-panel">
            <header className="panel-heading">
              <div>
                <span>账号</span>
                <h2>{accountAvailable ? "Live Memory 账号" : "个人档案"}</h2>
              </div>
              <p>{accountAvailable ? "管理账号信息，登录后资料和演出文字自动同步到云端。" : "设置页面中显示的昵称、用户名和头像。"}</p>
            </header>
            <div className="account-settings-grid">
              <div className="account-preview-card">
                <AccountAvatar settings={draft} />
                <strong>{accountLabel(draft)}</strong>
                <span>{draft.account.username ? `@${draft.account.username}` : "用户名待设置"}</span>
              </div>
              <div className="field-stack account-field-stack">
                <label className="field">昵称<input value={draft.account.nickname} onChange={(event) => updateAccount({ nickname: event.target.value })} placeholder="页面显示名，例如 Qi" /></label>
                <label className="field">用户名<input value={draft.account.username} onChange={(event) => updateAccount({ username: cleanUsernameInput(event.target.value) })} placeholder="4-32 位英文字母或数字" autoCapitalize="none" /></label>
                <label className="field avatar-upload-field">头像（可选）<span className="file-picker"><ImagePlus size={18} />{draft.account.avatarUrl ? "更换头像" : "选择图片"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseAvatar(event.target.files?.[0])} /></span></label>
                {accountAvailable && <label className="field">找回邮箱（可选）<input type="email" value={draft.account.recoveryEmail} onChange={(event) => updateAccount({ recoveryEmail: event.target.value })} placeholder="用于找回 Live Memory 密码" /></label>}
                {accountAvailable && <label className="field">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位，字符不限" /></label>}
              </div>
            </div>
            {accountAvailable ? (
              <>
                <p className="hint">{draft.account.recoveryEmail ? "找回邮箱用于接收 Live Memory 密码找回邮件。" : "不填写邮箱也能登录；需要找回密码时再补充邮箱。"}</p>
                <div className="button-row">
                  <button className="button primary" disabled={busy || !password} type="button" onClick={() => run("", handleAccountLogin)}>
                    {busy ? <Loader2 className="spin" /> : <ShieldCheck size={18} />}
                    登录 / 创建账号
                  </button>
                  <button className="button ghost" disabled={!draft.account.recoveryEmail || busy} type="button" onClick={() => run("找回邮件已发送", async () => { await requestPasswordReset(draft); })}>找回密码</button>
                  <button className="button ghost" disabled={!password || busy} type="button" onClick={() => run("密码已更新", async () => { await updateAccountPassword(draft, password); })}>更新密码</button>
                  <button className="button ghost" disabled={busy} type="button" onClick={() => run("正在打开 GitHub", async () => { await onSave(draft); await signInWithGithub(draft); })}><Github size={18} />GitHub 登录</button>
                  <button className="button ghost" type="button" onClick={() => run("已退出账号", async () => { await signOut(draft); setUserLabel("未登录"); setAccountSignedIn(false); })}>退出</button>
                </div>
                <p className="plain-hint">账号状态：{accountSignedIn ? `已登录（${userLabel}）` : "未登录"}</p>
              </>
            ) : (
              <>
                <div className="supabase-explain-card">
                  <strong>资料仅保存在当前浏览器</strong>
                  <p>昵称、头像和页面偏好不会离开这台设备。如需跨设备同步，需部署 Live Memory 账号服务（Supabase）。</p>
                </div>
                <div className="button-row">
                  <button className="button primary" type="button" onClick={() => onSave(draft)}><Check size={18} />保存资料</button>
                </div>
              </>
            )}
          </section>

          {syncSelected ? (
            <section className="panel sync-settings-panel">
              <header className="panel-heading">
                <div>
                  <span>同步</span>
                  <h2>连接个人 Supabase</h2>
                </div>
                <p>填入你的 Supabase 项目信息，将演出资料同步到个人云端。</p>
              </header>
              <div className="supabase-guide-panel">
                <strong>设置步骤</strong>
                <ol>
                  <li>在 Supabase 创建一个新项目。</li>
                  <li>在项目的 SQL Editor 中运行初始化脚本（见仓库文档）。</li>
                  <li>从 Settings → API 页面复制项目 URL 和 anon 公开密钥。</li>
                  <li>填入下方字段，点击"连接个人云端"完成连接。</li>
                </ol>
                <div className="button-row">
                  <a className="source-link" href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer"><ExternalLink size={16} />前往 Supabase</a>
                  <a className="source-link" href="https://github.com/Qi-i/live-memory/blob/main/docs/supabase-setup.md" target="_blank" rel="noreferrer"><BookOpen size={16} />查看完整设置教程</a>
                </div>
              </div>
              <div className="field-stack">
                <label className="field">项目 URL<input value={draft.supabase.url} onChange={(event) => updateSupabaseConfig({ url: event.target.value }, true)} placeholder="https://xxxx.supabase.co" /></label>
                <label className="field">anon 公开密钥<input type="password" value={draft.supabase.anonKey} onChange={(event) => updateSupabaseConfig({ anonKey: event.target.value }, true)} placeholder="在 Settings → API 页面复制" /></label>
              </div>
              <p className="plain-hint">{accountSignedIn ? "你已登录账号，连接个人云端时会自动生成密钥，无需额外输入密码。" : "未登录账号时，需要设置一个档案密码来保护个人云端。请牢记密码，换设备恢复时会用到。"}</p>
              <button className="inline-toggle" type="button" onClick={() => setShowCloudMore((value) => !value)}>
                <ChevronDown size={16} />
                {showCloudMore ? "收起高级设置" : "高级设置"}
              </button>
              {showCloudMore && (
                <div className="field-stack subtle-fields">
                  <label className="field">图片空间名称<input value={draft.supabase.mediaBucket} onChange={(event) => updateSupabaseConfig({ mediaBucket: event.target.value })} placeholder="默认 echo-media" /></label>
                  <p className="plain-hint">对应 Supabase 中的 Storage Bucket 名称，仅在手动修改过桶名时需要调整。</p>
                </div>
              )}
              <label className="toggle-row">
                <input type="checkbox" checked={draft.supabase.syncMedia} onChange={(event) => updateSupabaseConfig({ syncMedia: event.target.checked })} />
                <span><strong>同步图片</strong><small>{draft.supabase.syncMedia ? "海报、票根、座位图和现场照片将上传到你的 Supabase 图片空间。" : "仅同步演出文字记录，图片保留在当前设备。"}</small></span>
              </label>
              {showCloudConnectPanel ? (
                <>
                  {accountSignedIn ? (
                    <div className="supabase-explain-card">
                      <strong>使用当前账号连接</strong>
                      <p>同步密钥会基于当前登录的账号自动生成，不需要额外输入密码。</p>
                    </div>
                  ) : (
                    <label className="field">档案密码<input type="password" value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} placeholder="至少 8 位，请记住此密码" /></label>
                  )}
                  <div className="button-row">
                    <button className="button primary" disabled={!syncReady || busy || needsCloudPassword && !cloudPassword} type="button" onClick={() => run("", handleConnectCloud)}>
                      {busy ? <Loader2 className="spin" /> : <ShieldCheck size={18} />}
                      {syncConnected ? "重新连接个人云端" : "连接个人云端"}
                    </button>
                    {syncConnected && <button className="button ghost" type="button" onClick={() => { setCloudPassword(""); setShowCloudReconnect(false); }}><X size={18} />取消重新连接</button>}
                    <button className="button ghost" type="button" onClick={() => onSave(draft)}><Check size={18} />保存连接设置</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="plain-hint">个人云端已连接，数据可随时同步。更换项目、用户名或密码时才需要重新连接。</p>
                  <div className="button-row">
                    <button className="button ghost" type="button" onClick={() => setShowCloudReconnect(true)}><ShieldCheck size={18} />重新连接</button>
                    <button className="button ghost" type="button" onClick={() => onSave(draft)}><Check size={18} />保存连接设置</button>
                  </div>
                </>
              )}
              <div className="button-row">
                <button className="button primary" disabled={!syncReady || !syncConnected || busy} type="button" onClick={() => run("我的云端数据已更新", handleUploadToCloud)}>
                  <Upload size={18} />
                  上传到我的云端
                </button>
                <button className="button ghost" disabled={!syncReady || !syncConnected || busy} type="button" onClick={() => run("已从云端恢复", handleRestoreFromCloud)}>
                  <Download size={18} />
                  从云端恢复到本机
                </button>
              </div>
            </section>
          ) : accountAvailable ? (
            <section className="panel sync-guide-panel">
              <header className="panel-heading">
                <div>
                  <span>备份</span>
                  <h2>自动文字备份</h2>
                </div>
                <p>登录账号后，演出文字记录会自动备份到 Live Memory 云端。换新设备时，输入同一账号密码即可恢复。</p>
              </header>
              <p className="plain-hint">最近备份：{draft.accountBackup.lastBackupAt ? new Date(draft.accountBackup.lastBackupAt).toLocaleString("zh-CN") : "登录后自动备份"}</p>
            </section>
          ) : (
            <section className="panel sync-guide-panel">
              <header className="panel-heading">
                <div>
                  <span>备份</span>
                  <h2>本地保存</h2>
                </div>
                <p>所有演出记录保存在当前浏览器中。可在下方"数据管理"区域导出 JSON 文件作为手动备份。</p>
              </header>
            </section>
          )}

          <section className="settings-data-grid">
            <div className="panel">
              <header className="panel-heading">
                <div>
                  <span>导出</span>
                  <h2>数据导出</h2>
                </div>
                <p>导出完整数据用于备份或迁移。JSON 包含图片，CSV 和文字备份仅含文字记录。</p>
              </header>
              <div className="button-row">
                <button className="button primary" type="button" onClick={() => exportJson(records)}>
                  <Download size={18} />
                  导出 JSON
                </button>
                <button className="button ghost" type="button" onClick={() => exportCsv(records)}>
                  <Download size={18} />
                  导出 CSV
                </button>
                <button className="button ghost" type="button" onClick={() => exportTextJson(records)}>
                  <Download size={18} />
                  导出文字备份
                </button>
              </div>
            </div>

            <label className="panel import-file">
              <Upload />
              <strong>导入备份</strong>
              <span>选择之前导出的 JSON 文件，恢复或迁移到新设备。</span>
              <input type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && void importJson(event.target.files[0])} />
            </label>

            <section className="panel recycle-panel">
              <header className="panel-heading">
                <div>
                  <span>回收站</span>
                  <h2>{trashRecords.length ? `${trashRecords.length} 条记录` : "回收站为空"}</h2>
                </div>
                <p>移入回收站的记录仍可恢复。永久删除后，文字和图片都无法找回。</p>
              </header>
              {trashRecords.length > 0 && (
                <div className="recycle-list">
                  {trashRecords.map((record) => (
                    <article key={record.id}>
                      <div>
                        <strong>{record.title}</strong>
                        <span>{record.date} · {record.artists.join(" / ") || "艺人待补"}</span>
                      </div>
                      <div className="button-row">
                        <button className="button ghost compact" type="button" onClick={() => void onRestore(record)}><RotateCcw size={16} />恢复</button>
                        <button className="button danger compact" type="button" onClick={() => onPermanentDelete(record)}><Trash2 size={16} />永久删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>

        <div className="settings-col-side">
          <section className="panel storage-location-panel">
            <header className="panel-heading">
              <div>
                <span>保存</span>
                <h2>数据保存位置</h2>
              </div>
              <p>选择你的演出记录保存在哪里。</p>
            </header>
            <div className="storage-choice-grid">
              <button className={draft.storageMode === "local" ? "storage-choice is-active" : "storage-choice"} type="button" onClick={() => chooseStorageMode("local")}>
                <span>01</span>
                <strong>{accountAvailable ? "设备保存 + 文字备份" : "保存在当前设备"}</strong>
                <em>{accountAvailable ? "演出文字随 Live Memory 账号备份，图片保留在当前设备。" : "所有数据保存在浏览器本地，可随时导出 JSON 备份。"}</em>
              </button>
              <button className={draft.storageMode === "supabase" ? "storage-choice is-active" : "storage-choice"} type="button" onClick={() => chooseStorageMode("supabase")}>
                <span>02</span>
                <strong>Supabase 完整同步</strong>
                <em>连接你自己的 Supabase 项目，文字和图片均可跨设备同步。</em>
              </button>
            </div>
            {syncSelected && (
              <div className="supabase-explain-card">
                <strong>什么是 Supabase？</strong>
                <p>Supabase 是免费的云数据库服务，为你提供独立的数据库和图片存储空间。创建项目后，将项目 URL 和 anon 公开密钥填入下方即可连接。</p>
                <a className="source-link" href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer"><ExternalLink size={16} />打开 Supabase 控制台</a>
              </div>
            )}
          </section>

          <div className="panel">
            <header className="panel-heading">
              <div>
                <span>显示</span>
                <h2>默认视图</h2>
              </div>
            </header>
            <label className="field">
              默认视图
              <select value={draft.defaultView} onChange={(event) => setDraft({ ...draft, defaultView: event.target.value as ArchiveView })}>
                {(Object.keys(viewLabels) as ArchiveView[]).map((item) => <option key={item} value={item}>{viewLabels[item]}</option>)}
              </select>
            </label>
            <label className="field">
              海报每行
              <select value={draft.posterColumns} onChange={(event) => setDraft({ ...draft, posterColumns: Number(event.target.value) })}>
                {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 张</option>)}
              </select>
            </label>
            <button className="button primary" type="button" onClick={() => onSave(draft)}>
              <Check size={18} />
              保存显示设置
            </button>
          </div>

          <div className="panel">
            <header className="panel-heading">
              <div>
                <span>地图</span>
                <h2>足迹地图</h2>
              </div>
              <p>不需要真实地图时保持关闭，页面会显示城市和场馆统计。</p>
            </header>
            <label className="field">地图来源<select value={draft.map.provider} onChange={(event) => { setShowMapMore(false); setDraft({ ...draft, map: { ...draft.map, provider: event.target.value as AppSettings["map"]["provider"] } }); }}><option value="none">关闭真实地图</option><option value="amap">高德地图</option><option value="baidu">百度地图</option></select></label>
            {draft.map.provider === "none" && <p className="hint">关闭时显示城市和场馆统计，不加载在线地图。</p>}
            {draft.map.provider === "amap" && (
              <>
                <label className="field">高德地图密钥<input type="password" value={draft.map.amapKey} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapKey: event.target.value } })} placeholder="从高德开放平台复制 Web 服务 Key" /></label>
                <button className="inline-toggle" type="button" onClick={() => setShowMapMore((value) => !value)}>
                  <ChevronDown size={16} />
                  {showMapMore ? "收起高德高级设置" : "高德高级设置"}
                </button>
                {showMapMore && <label className="field">安全密钥<input type="password" value={draft.map.amapSecurityCode} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapSecurityCode: event.target.value } })} placeholder="只有控制台要求时才填写" /></label>}
              </>
            )}
            {draft.map.provider === "baidu" && <label className="field">百度地图密钥<input type="password" value={draft.map.baiduAk} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, baiduAk: event.target.value } })} placeholder="从百度地图开放平台复制浏览器端 AK" /></label>}
            {draft.map.provider !== "none" && <p className="hint">地图密钥保存在当前设备的浏览器设置中。</p>}
            <div className="button-row">
              <button className="button primary" type="button" onClick={() => onSave(draft)}>
                <MapIcon size={18} />
                保存地图设置
              </button>
            </div>
          </div>

          <section className="panel health settings-health-panel">
            <header className="panel-heading">
              <div>
                <span>检查</span>
                <h2>保存状态</h2>
              </div>
            </header>
            <InfoLine label="本地记录" value={`${health.localRecords} 条`} />
            <InfoLine label="回收站" value={`${trashRecords.length} 条`} />
            <InfoLine label="图片附件" value={`${health.mediaAssets} 个`} />
            {syncSelected && draft.supabase.syncMedia && <InfoLine label="待上传图片" value={`${health.localOnlyMedia} 个`} />}
            {syncSelected && draft.supabase.syncMedia && <InfoLine label="个人云端图片" value={`${health.remoteMedia} 个`} />}
            <InfoLine label="最近文字备份" value={draft.accountBackup.lastBackupAt ? new Date(draft.accountBackup.lastBackupAt).toLocaleString("zh-CN") : "尚未备份"} />
            {syncSelected && <InfoLine label="最近完整同步" value={health.lastSyncAt ? new Date(health.lastSyncAt).toLocaleString("zh-CN") : "尚未同步"} />}
          </section>
        </div>
      </div>
    </section>
  );
}

function userDisplayName(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) return "未登录";
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const handle = ["nickname", "user_name", "preferred_username", "name"]
    .map((key) => metadata?.[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const email = user.email && !user.email.endsWith("@users.live-memory.local") ? user.email : "";
  return handle || email || "已登录";
}

function accountLabel(settings: AppSettings) {
  return settings.account.nickname.trim() || settings.account.username.trim() || "未设置账号";
}

function storageLocationLabel(settings: AppSettings) {
  if (settings.storageMode === "supabase") {
    return hasPersonalCloudConnection(settings) ? "云同步已连接" : "云端待连接";
  }
  return hasAccountCloudConfig(settings) ? "设备 + 文字备份" : "仅当前设备";
}

function cleanUsernameInput(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32).toLowerCase();
}

function statusClass(status: EventStatus) {
  return `status-${status}`;
}

function DetailDrawer({
  record,
  onClose,
  onEdit,
  onDelete,
  onZoom,
  onSave,
}: {
  record: EventRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onZoom: (media: MediaAsset) => void;
  onSave: (record: EventRecord) => Promise<void>;
}) {
  const poster = primaryMedia(record);
  const seatMaps = mediaByKind(record, "seatMap");
  const photos = mediaByKind(record, "livePhoto");
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside className="detail-drawer">
        <header>
          <button className="icon" type="button" onClick={onClose} aria-label="关闭"><X /></button>
          <div className="drawer-actions">
            <IconButton label={record.favorite ? "取消收藏" : "收藏"} icon={<Heart />} onClick={() => onSave({ ...record, favorite: !record.favorite })} />
            <IconButton label="编辑" icon={<Pencil />} onClick={onEdit} />
            <IconButton label="删除" icon={<Trash2 />} danger onClick={onDelete} />
          </div>
        </header>
        <section className="detail-hero">
          <button className="detail-poster" type="button" onClick={() => poster && onZoom(poster)}>
            {poster ? <MediaImage media={poster} alt={record.title} /> : <ImagePlus />}
          </button>
          <div>
            <span className="badge">{categoryLabels[record.category]} · {statusLabels[record.status]}</span>
            <h2>{record.title}</h2>
            <p>{record.artists.join(" / ") || "艺人待补"}</p>
            <div className="detail-facts">
              <InfoLine label="日期" value={formatDateCn(record.date, record.time)} />
              <InfoLine label="场馆" value={`${record.city || "城市待补"} | ${record.venue || "场馆待补"}`} />
              <InfoLine label="票价" value={record.price ? `¥${record.price}` : record.publicPriceRange || "未填票价"} />
              <InfoLine label="座位" value={record.seat || "座位待补"} />
              <InfoLine label="同行" value={record.companions.join(" / ") || "未记录"} />
              <InfoLine label="来源" value={sourceLabels[record.sourceChannel]} />
            </div>
            {record.sourceUrl && <a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />打开来源页</a>}
          </div>
        </section>
        <MediaSection title="座位图" items={seatMaps} onZoom={onZoom} />
        <MediaSection title="现场精选" items={photos} onZoom={onZoom} />
        <section className="detail-section">
          <h3>标签与记录</h3>
          <div className="tag-row">{record.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <p>{record.note || "还没有写下现场记忆。"}</p>
          {record.setlist.length > 0 && <ol className="setlist">{record.setlist.map((song) => <li key={song}>{song}</li>)}</ol>}
        </section>
      </aside>
    </div>
  );
}

function MediaSection({ title, items, onZoom }: { title: string; items: MediaAsset[]; onZoom: (media: MediaAsset) => void }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {items.length ? (
        <div className="media-grid">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => onZoom(item)}>
              <MediaImage media={item} alt={item.title || mediaKindLabels[item.kind]} />
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-line">暂未保存{title}。</p>
      )}
    </section>
  );
}

function RecordEditor({ record, onCancel, onSave }: { record: EventRecord; onCancel: () => void; onSave: (record: EventRecord) => Promise<void> }) {
  const [draft, setDraft] = useState(record);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await onSave({
      ...draft,
      lineup: draft.artists.map((name) => ({ name, role: "artist" })),
      updatedAt: nowIso(),
    });
    setSaving(false);
  }

  async function addFiles(kind: "poster" | "ticket" | "seatMap" | "livePhoto", files: FileList | null) {
    if (!files?.length) return;
    const media = await Promise.all(Array.from(files).map((file) => fileToMedia(draft.id, kind, file)));
    setDraft((current) => ({
      ...current,
      media: kind === "poster" || kind === "ticket" || kind === "seatMap"
        ? current.media.filter((item) => item.kind !== kind).concat(media)
        : current.media.concat(media),
    }));
  }

  return (
    <div className="modal-backdrop">
      <form className="editor" onSubmit={submit}>
        <header>
          <div>
            <p>Record editor</p>
            <h2>{record.title ? "编辑演出" : "新增演出"}</h2>
          </div>
          <button className="icon" type="button" onClick={onCancel}><X /></button>
        </header>
        <div className="form-grid">
          <label className="field wide">名称<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="field wide">演员 / 歌手阵容<input value={draft.artists.join(" / ")} onChange={(event) => setDraft({ ...draft, artists: splitTextList(event.target.value) })} placeholder="多个用 / 或 、 分隔" /></label>
          <label className="field">类型<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as EventCategory })}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field">状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EventStatus })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field">日期<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
          <label className="field">时间<input type="time" value={draft.time || ""} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
          <label className="field">城市<input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
          <label className="field">场馆<input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></label>
          <label className="field">票价<input type="number" value={draft.price ?? ""} onChange={(event) => setDraft({ ...draft, price: event.target.value ? Number(event.target.value) : null })} /></label>
          <label className="field">公开票价<input value={draft.publicPriceRange || ""} onChange={(event) => setDraft({ ...draft, publicPriceRange: event.target.value })} /></label>
          <label className="field wide">座位<input value={draft.seat || ""} onChange={(event) => setDraft({ ...draft, seat: event.target.value })} /></label>
          <label className="field wide">同行人<input value={draft.companions.join(" / ")} onChange={(event) => setDraft({ ...draft, companions: splitTextList(event.target.value) })} /></label>
          <label className="field wide">标签<input value={draft.tags.join(" / ")} onChange={(event) => setDraft({ ...draft, tags: splitTextList(event.target.value) })} /></label>
          <label className="field wide">来源链接<input value={draft.sourceUrl || ""} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></label>
          <label className="upload-card">票根/海报<input type="file" accept="image/*" onChange={(event) => addFiles("poster", event.target.files)} /></label>
          <label className="upload-card">电子票根<input type="file" accept="image/*" onChange={(event) => addFiles("ticket", event.target.files)} /></label>
          <label className="upload-card">座位图<input type="file" accept="image/*" onChange={(event) => addFiles("seatMap", event.target.files)} /></label>
          <label className="upload-card">现场精选<input type="file" accept="image/*" multiple onChange={(event) => addFiles("livePhoto", event.target.files)} /></label>
          <div className="wide preview-strip">{draft.media.map((item) => <img key={item.id} src={item.src} alt={item.title || ""} />)}</div>
          <label className="field wide">曲目<textarea value={draft.setlist.join("\n")} onChange={(event) => setDraft({ ...draft, setlist: splitTextList(event.target.value) })} /></label>
          <label className="field wide">现场记忆<textarea value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onCancel}>取消</button>
          <button className="button primary" disabled={saving} type="submit">{saving ? <Loader2 className="spin" /> : <Check size={18} />}保存</button>
        </footer>
      </form>
    </div>
  );
}

function ImportDrawer({ onClose, onSave, flash }: { onClose: () => void; onSave: (record: EventRecord) => Promise<void>; flash: (message: string) => void }) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [loading, setLoading] = useState(false);

  async function parse() {
    setLoading(true);
    const next = await createDraftsFromText(text);
    setDrafts(next);
    setLoading(false);
    flash(`生成 ${next.length} 条草稿`);
  }

  async function importImages(files: FileList | null) {
    if (!files?.length) return;
    const nextDrafts: ImportDraft[] = Array.from(files).map((file) => ({
      id: createId("draft"),
      title: file.name.replace(/\.[^.]+$/, ""),
      category: "concert",
      status: "watched",
      date: new Date().toISOString().slice(0, 10),
      city: "",
      venue: "",
      artists: [],
      sourceChannel: "",
      note: "由批量图片导入生成，请补充演出基础信息。",
      importConfidence: 0.35,
    }));
    setDrafts((current) => current.concat(nextDrafts));
    for (let index = 0; index < files.length; index += 1) {
      const record = draftToRecord(nextDrafts[index]);
      record.media = [await fileToMedia(record.id, "poster", files[index])];
      await onSave(record);
    }
    flash(`已导入 ${files.length} 张图片草稿`);
  }

  async function saveDraft(draft: ImportDraft) {
    await onSave(draftToRecord(draft));
  }

  return (
    <div className="drawer-backdrop">
      <aside className="import-drawer">
        <header>
          <div>
            <p>Batch import</p>
            <h2>批量添加</h2>
          </div>
          <button className="icon" type="button" onClick={onClose}><X /></button>
        </header>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴多条大麦链接、演出文字，或手机提取文字结果。每条链接会生成一条可编辑草稿。" />
        <div className="button-row">
          <button className="button primary" disabled={loading} type="button" onClick={parse}>{loading ? <Loader2 className="spin" /> : <Sparkles size={18} />}识别草稿</button>
          <label className="button ghost"><ImagePlus size={18} />批量图片<input type="file" accept="image/*" multiple onChange={(event) => importImages(event.target.files)} /></label>
        </div>
        <div className="draft-list">
          {drafts.map((draft) => (
            <article key={draft.id}>
              {draft.posterUrl && <img src={draft.posterUrl} alt="" />}
              <div>
                <span>{categoryLabels[draft.category]} · 置信度 {Math.round(draft.importConfidence * 100)}%</span>
                <h3>{draft.title}</h3>
                <p>{draft.date} · {draft.city || "城市待补"} · {draft.venue || "场馆待补"}</p>
              </div>
              <button className="button primary" type="button" onClick={() => saveDraft(draft)}>加入档案</button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function ImageZoom({ media, onClose }: { media: MediaAsset; onClose: () => void }) {
  return (
    <div className="zoom-backdrop" onClick={onClose}>
      <button className="icon zoom-close" type="button" onClick={onClose}><X /></button>
      <img src={media.src} alt={media.title || ""} onClick={(event) => event.stopPropagation()} />
      <div className="zoom-tools">
        <a className="button primary" href={media.src} download={media.title || "echo-media"}><Download size={18} />下载</a>
        <button className="button ghost" type="button" onClick={() => navigator.clipboard?.writeText(media.src)}><Copy size={18} />复制地址</button>
      </div>
    </div>
  );
}

function ConfirmDialog({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  async function confirm() {
    setWorking(true);
    try {
      await action.onConfirm();
      onClose();
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="confirm-backdrop" role="presentation" onClick={onClose}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <span className="confirm-icon"><Trash2 /></span>
        <h2 id="confirm-title">{action.title}</h2>
        <p>{action.message}</p>
        <div className="button-row">
          <button className="button ghost" type="button" disabled={working} onClick={onClose}>取消</button>
          <button className={`button ${action.danger ? "danger" : "primary"}`} type="button" disabled={working} onClick={() => void confirm()}>{working ? <Loader2 className="spin" /> : <Trash2 size={18} />}{action.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="info-line">
      <span>{label}</span>
      <b>{value}</b>
    </p>
  );
}

function IconButton({ label, icon, onClick, danger }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`icon-action ${danger ? "danger" : ""}`} type="button" title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

function Metric({ title, value, hint, light }: { title: string; value: ReactNode; hint: string; light?: boolean }) {
  return (
    <div className={`metric ${light ? "light" : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <em>{hint}</em>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <Ticket />
      <h2>还没有匹配的演出</h2>
      <p>换一个筛选条件，或者从大麦链接、截图、图片开始批量添加。</p>
    </section>
  );
}

function viewIcon(view: ArchiveView) {
  const icons: Record<ArchiveView, ReactNode> = {
    poster: <ImagePlus />,
    wallet: <Archive />,
    ticket: <Ticket />,
    timeline: <ChevronDown />,
    price: <CircleDollarSign />,
    summary: <Sparkles />,
    calendar: <CalendarDays />,
    venue: <MapIcon />,
    list: <List />,
  };
  return icons[view];
}

function filterRecords(records: EventRecord[], filters: Filters) {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (query) {
      const text = [record.title, record.city, record.venue, record.artists.join(" "), record.tags.join(" "), record.note].join(" ").toLowerCase();
      if (!text.includes(query)) return false;
    }
    if (filters.categories.length && !filters.categories.includes(record.category)) return false;
    if (filters.statuses.length && !filters.statuses.includes(record.status)) return false;
    if (filters.years.length && !filters.years.includes(record.date.slice(0, 4))) return false;
    if (filters.cities.length && !filters.cities.includes(record.city)) return false;
    if (filters.artists.length && !record.artists.some((artist) => filters.artists.includes(artist))) return false;
    if (filters.tags.length && !record.tags.some((tag) => filters.tags.includes(tag))) return false;
    return true;
  });
}

function sortRecords(records: EventRecord[], sort: SortMode) {
  const next = [...records];
  if (sort === "date-asc") return next.sort((a, b) => a.date.localeCompare(b.date));
  if (sort === "price-desc") return next.sort((a, b) => (b.price || 0) - (a.price || 0));
  if (sort === "updated-desc") return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === "smart") {
    return next.sort((a, b) => {
      const aFuture = daysFromToday(a.date) >= 0 ? 1 : 0;
      const bFuture = daysFromToday(b.date) >= 0 ? 1 : 0;
      if (aFuture !== bFuture) return bFuture - aFuture;
      return b.date.localeCompare(a.date);
    });
  }
  return next.sort((a, b) => b.date.localeCompare(a.date));
}

function buildFacets(records: EventRecord[]) {
  return {
    categories: unique(records.map((record) => record.category)) as EventCategory[],
    statuses: unique(records.map((record) => record.status)) as EventStatus[],
    years: unique(records.map((record) => record.date.slice(0, 4))).sort((a, b) => b.localeCompare(a)),
    cities: unique(records.map((record) => record.city).filter(Boolean)),
    artists: unique(records.flatMap((record) => record.artists)).slice(0, 24),
    tags: unique(records.flatMap((record) => record.tags)).slice(0, 24),
  };
}

function unique<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : values.concat(value);
}

function topRows(values: string[], limit = 8): [string, number][] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, limit);
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const value = key(item);
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}

function draftToRecord(draft: ImportDraft): EventRecord {
  const id = createId("record");
  const timestamp = nowIso();
  return {
    schemaVersion: 2,
    id,
    title: draft.title,
    category: draft.category,
    status: draft.status,
    recordState: "normal",
    date: draft.date,
    time: draft.time,
    city: draft.city,
    venue: draft.venue,
    address: draft.address,
    artists: draft.artists,
    lineup: draft.artists.map((name) => ({ name, role: "artist" })),
    price: draft.price ?? null,
    publicPriceRange: draft.publicPriceRange,
    seat: "",
    companions: [],
    tags: draft.category === "festival" ? ["音乐节"] : [],
    note: draft.note || "",
    setlist: [],
    sourceChannel: draft.sourceChannel,
    sourceUrl: draft.sourceUrl,
    importConfidence: draft.importConfidence,
    media: draft.posterUrl ? [makeMedia(id, "poster", draft.posterUrl, "公开海报", "external")] : [],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function exportJson(records: EventRecord[]) {
  downloadBlob(
    JSON.stringify({ app: "echo-archive", version: 2, exportedAt: nowIso(), records }, null, 2),
    `echo-archive-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}

function exportTextJson(records: EventRecord[]) {
  downloadBlob(
    JSON.stringify({ app: "live-memory", version: 2, mediaIncluded: false, exportedAt: nowIso(), records: records.map(withoutLocalMedia) }, null, 2),
    `live-memory-text-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}

function exportCsv(records: EventRecord[]) {
  const rows = [["title", "artists", "date", "time", "city", "venue", "price", "seat", "status", "category"]];
  records.forEach((record) => rows.push([record.title, record.artists.join("/"), record.date, record.time || "", record.city, record.venue, String(record.price || ""), record.seat || "", statusLabels[record.status], categoryLabels[record.category]]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(`\ufeff${csv}`, `echo-archive-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
}
