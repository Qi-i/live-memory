import {
  Check,
  Download,
  ExternalLink,
  Github,
  ImagePlus,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, ArchiveView, EventRecord } from "./domain";
import { viewLabels } from "./domain";
import { fileToAvatar, downloadBlob, nowIso } from "./media";
import { currentStorageScope, listRecords, replaceAllRecords } from "./storage";
import { mergeBackupAdditions, parseBackupImport, type BackupImportPlan } from "./backupImport";
import {
  friendlySupabaseErrorMessage,
  getLinkedProviders,
  hasPersonalCloudConnection,
  hasSupabaseConfig,
  linkGithubIdentity,
  pullRecordsFromSupabase,
  refreshSignedMediaUrls,
  signInStorageWithAccount,
  updateAccountPassword,
} from "./supabase";
import { ThemeSettingsPanel, projectUrl } from "./experience";
import { withoutLocalMedia } from "./syncModel";

interface SettingsPageProps {
  settings: AppSettings;
  records: EventRecord[];
  deviceOnly?: boolean;
  health: {
    localRecords: number;
    mediaAssets: number;
    localOnlyMedia: number;
    remoteMedia: number;
    lastSyncAt?: string;
  };
  busy: boolean;
  setBusy: (value: boolean) => void;
  setRecords: (records: EventRecord[]) => void;
  onSave: (settings: AppSettings, message?: string) => Promise<AppSettings>;
  onRestore: (record: EventRecord) => Promise<void>;
  onPermanentDelete: (record: EventRecord) => Promise<void>;
  onSignOut: () => Promise<void>;
  flash: (message: string) => void;
}

export function SettingsPage({
  settings,
  records,
  deviceOnly = false,
  health,
  busy,
  setBusy,
  setRecords,
  onSave,
  onRestore,
  onPermanentDelete,
  onSignOut,
  flash,
}: SettingsPageProps) {
  const [draft, setDraft] = useState(settings);
  const [password, setPassword] = useState("");
  const [importPreview, setImportPreview] = useState<BackupImportPlan | null>(null);
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    if (deviceOnly) return;
    let active = true;
    getLinkedProviders(settings)
      .then((providers) => { if (active) setLinkedProviders(providers); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [deviceOnly, settings.account.username]);
  const cloudReady = hasSupabaseConfig(draft);
  const cloudConnected = hasPersonalCloudConnection(draft);
  const trashRecords = records.filter((record) => record.deletedAt);
  const githubLinked = linkedProviders.includes("github");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      flash(friendlySupabaseErrorMessage(error, "操作未完成"));
    } finally {
      setBusy(false);
    }
  }

  async function selectAvatar(file?: File) {
    if (!file) return;
    const avatarUrl = await fileToAvatar(file);
    setDraft((current) => ({ ...current, account: { ...current.account, avatarUrl } }));
  }

  async function connectPersonalCloud() {
    const connected = await signInStorageWithAccount(draft);
    setDraft(connected.settings);
    await onSave(connected.settings, connected.message);
  }


  async function restoreCloud() {
    const result = await pullRecordsFromSupabase(draft, records);
    await replaceAllRecords(result.records);
    setRecords(result.records);
    const next = { ...draft, lastSyncAt: nowIso() };
    setDraft(next);
    await onSave(next, result.message);
  }

  async function refreshCloudMedia() {
    const next = await refreshSignedMediaUrls(draft, records);
    await replaceAllRecords(next);
    setRecords(next);
    flash("云端图片链接已刷新");
  }

  async function inspectBackup(file?: File) {
    if (!file) return;
    setImportPreview(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("JSON 文件无法解析，当前档案没有改动");
    }
    const plan = parseBackupImport(parsed, records, file.name);
    setImportPreview(plan);
  }

  async function confirmImport() {
    if (!importPreview || busy) return;
    const scope = currentStorageScope();
    await run(async () => {
      const current = await listRecords();
      if (currentStorageScope() !== scope) throw new Error("账号已经切换，请重新选择备份文件");
      const merged = mergeBackupAdditions(current, importPreview);
      const added = merged.length - current.length;
      if (added) await replaceAllRecords(merged);
      if (currentStorageScope() !== scope) throw new Error("账号已经切换，已停止应用导入结果");
      if (added) setRecords(merged);
      setImportPreview(null);
      flash(added ? `已新增 ${added} 条档案，原有 ${current.length} 条全部保留` : "没有新增记录；所有已有档案均已保留");
    });
  }

  return (
    <section className="settings-page-v2">
      {deviceOnly && <aside className="device-local-notice" role="note"><strong>本机独立档案 · 无需公共云</strong><p>所有记录存储在当前浏览器的 IndexedDB。本机数据没有独立登录密码，能访问此浏览器的人可能看到档案；清理网站数据或卸载浏览器可能导致数据丢失，请定期导出“完整 JSON”并单独妥善保管。</p></aside>}
      <ThemeSettingsPanel />

      <div className="settings-layout-v2">
        <div className="settings-main-v2">
          <section className="settings-module account-module-v2">
            <ModuleHeader eyebrow={deviceOnly ? "本机档案" : "账号"} title={deviceOnly ? "个人档案信息" : "现场记账号"} description={deviceOnly ? "昵称和头像仅保存在当前设备，不需要注册账号。" : "查看个人资料、登录方式和密码设置。"} />
            <div className="account-profile-v2">
              <div className="account-avatar-preview-v2">
                <span>{draft.account.avatarUrl ? <img src={draft.account.avatarUrl} alt={draft.account.nickname} /> : draft.account.nickname.slice(0, 1).toUpperCase()}</span>
                <strong>{draft.account.nickname || draft.account.username}</strong>
                <small>@{draft.account.username}</small>
              </div>
              <div className="settings-fields-v2">
                <label>昵称<input value={draft.account.nickname} onChange={(event) => setDraft({ ...draft, account: { ...draft.account, nickname: event.target.value } })} /></label>
                {!deviceOnly && <label>用户名<input value={draft.account.username} disabled title="用户名与账号身份绑定，不在此处直接修改" /></label>}
                <label className="avatar-picker-v2">头像<span><ImagePlus />{draft.account.avatarUrl ? "更换头像" : "选择头像"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectAvatar(event.target.files?.[0])} /></label>
                {!deviceOnly && <label>备用邮箱<input type="email" value={draft.account.recoveryEmail} onChange={(event) => setDraft({ ...draft, account: { ...draft.account, recoveryEmail: event.target.value } })} placeholder="用于身份核对和密码恢复" /></label>}
              </div>
            </div>
            <div className="settings-actions-v2">
              <button className="button primary" type="button" disabled={busy} onClick={() => void onSave(draft)}><Check />保存账号资料</button>
              {!deviceOnly && <label className="inline-password-v2">新密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label>}
              {!deviceOnly && <button className="button ghost" type="button" disabled={busy || !password} onClick={() => void run(async () => { await updateAccountPassword(draft, password); setPassword(""); flash("密码已更新"); })}><ShieldCheck />更新密码</button>}
              {!deviceOnly && <button className="button ghost" type="button" disabled={busy || githubLinked} title="绑定后可使用同一个账号的用户名密码或 GitHub 登录" onClick={() => void run(async () => { await linkGithubIdentity(draft); })}><Github />{githubLinked ? "GitHub 已绑定" : "绑定 GitHub"}</button>}
              <button className="button ghost" type="button" disabled={busy} onClick={() => void run(onSignOut)}>{deviceOnly ? "关闭本机档案（保留记录）" : "退出账号"}</button>
            </div>
          </section>

          {!deviceOnly && <section className="settings-module cloud-module-v2">
            <ModuleHeader eyebrow="同步" title="个人 Supabase" description="连接自己的 Supabase 后，新增与修改会自动同步；无需手动上传整份档案。" />
            <div className="cloud-status-v2">
              <span className={cloudConnected ? "is-connected" : ""}><i />{cloudConnected ? "个人云端已连接" : cloudReady ? "配置已保存，等待连接" : "尚未填写连接信息"}</span>
              <strong>{health.remoteMedia} 个云端图片</strong>
            </div>
            <div className="settings-fields-v2 settings-fields-two-v2">
              <label title="在 Supabase 项目设置的 API 页面复制 Project URL">项目 URL<input value={draft.supabase.url} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, url: event.target.value, ownerKey: "" } })} placeholder="https://xxxx.supabase.co" /></label>
              <label title="只填写 anon 或 publishable key，不要填写 service_role 或数据库密码">anon / publishable key<input type="password" value={draft.supabase.anonKey} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, anonKey: event.target.value, ownerKey: "" } })} /></label>
              <label title="用于存放海报、票根和照片；默认名称为 echo-media">图片空间<input value={draft.supabase.mediaBucket} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, mediaBucket: event.target.value } })} placeholder="echo-media" /></label>
              <label className="toggle-field-v2"><input type="checkbox" checked={draft.supabase.syncMedia} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, syncMedia: event.target.checked } })} /><span><strong>同步图片</strong><small>海报、票根、座位图和现场照片</small></span></label>
            </div>
            <p className="settings-help-v2">项目 URL 和公开密钥可在 Supabase 的 Project Settings → API 中找到。这里只能填写 anon 或 publishable key。</p>
            <div className="settings-actions-v2">
              <button className="button primary" type="button" disabled={busy || !cloudReady} onClick={() => void run(connectPersonalCloud)}>{busy ? <Loader2 className="spin" /> : <ShieldCheck />}{cloudConnected ? "重新连接" : "连接个人云端"}</button>
              <button className="button ghost" type="button" disabled={busy || !cloudConnected} onClick={() => void run(restoreCloud)}><Download />从云端恢复</button>
              <button className="button ghost" type="button" disabled={busy || !cloudConnected || !draft.supabase.syncMedia} onClick={() => void run(refreshCloudMedia)}><RefreshCw />刷新图片链接</button>
              <button className="button ghost" type="button" onClick={() => void onSave(draft)}><Check />保存连接设置</button>
            </div>
          </section>}

          <section className="settings-module data-module-v2">
            <ModuleHeader eyebrow="数据" title="导出、导入与回收站" description="可导出备份、恢复记录或处理已删除内容。" />
            <div className="data-action-grid-v2">
              <button type="button" onClick={() => exportJson(records)}><Download /><span><strong>完整 JSON</strong><small>包含当前图片数据</small></span></button>
              <button type="button" onClick={() => exportText(records)}><Download /><span><strong>文字备份</strong><small>不包含本地图片</small></span></button>
              <button type="button" onClick={() => exportCsv(records)}><Download /><span><strong>CSV 表格</strong><small>便于统计和整理</small></span></button>
              <label><Upload /><span><strong>安全导入 JSON</strong><small>先预览，仅合并新记录</small></span><input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void run(() => inspectBackup(file)); }} /></label>
            </div>
            {importPreview && (
              <section className="backup-import-preview" role="region" aria-label="JSON 备份导入预览">
                <div className="backup-import-preview-head">
                  <div><span>IMPORT PREVIEW · 只合并，不覆盖</span><h3>确认导入内容</h3><p title={importPreview.filename}>{importPreview.filename}</p></div>
                  <button type="button" aria-label="取消导入" onClick={() => setImportPreview(null)}><X /></button>
                </div>
                <div className="backup-import-counts">
                  <div><strong>{importPreview.additions.length}</strong><span>待新增</span></div>
                  <div><strong>{importPreview.duplicateCount}</strong><span>已有 ID，跳过</span></div>
                  <div><strong>{importPreview.existingCount}</strong><span>当前档案，保留</span></div>
                </div>
                <p className="backup-import-explain">导入只添加尚不存在的记录；同 ID 的现有记录、照片、编辑内容和回收站均不会被覆盖或删除。{importPreview.deletedCount ? `备份中另有 ${importPreview.deletedCount} 条已删除记录，将保留其回收站状态。` : ""}使用云端同步的账号，新增记录后可能自动同步到已连接的个人云端。</p>
                <div className="backup-import-actions"><button type="button" className="button ghost" onClick={() => setImportPreview(null)}>取消</button><button type="button" className="button primary" disabled={!importPreview.additions.length || busy} onClick={() => void confirmImport()}><Check />{importPreview.additions.length ? `确认新增 ${importPreview.additions.length} 条` : "没有可新增的档案"}</button></div>
              </section>
            )}
            <div className="recycle-v2">
              <header><strong>回收站</strong><span>{trashRecords.length} 条</span></header>
              {trashRecords.length ? trashRecords.map((record) => <article key={record.id}><div><strong>{record.title}</strong><span>{record.date} · {record.artists.join(" / ") || "艺人待补"}</span></div><div><button type="button" onClick={() => void onRestore(record)}><RefreshCw />恢复</button><button className="is-danger" type="button" onClick={() => void onPermanentDelete(record)}><Trash2 />永久删除</button></div></article>) : <p>回收站为空。</p>}
            </div>
          </section>
        </div>

        <aside className="settings-side-v2">
          <section className="settings-module compact-settings-v2">
            <ModuleHeader eyebrow="显示" title="默认档案视图" description="进入档案页时采用的默认阅读方式。" />
            <label>默认视图<select value={draft.defaultView} onChange={(event) => setDraft({ ...draft, defaultView: event.target.value as ArchiveView })}>{(Object.keys(viewLabels) as ArchiveView[]).map((view) => <option key={view} value={view}>{viewLabels[view]}</option>)}</select></label>
            <label>海报密度<select value={draft.posterColumns} onChange={(event) => setDraft({ ...draft, posterColumns: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 列</option>)}</select></label>
            <button className="button primary" type="button" onClick={() => void onSave(draft)}><Check />保存显示设置</button>
          </section>

          <section className="settings-module compact-settings-v2">
            <ModuleHeader eyebrow="地图" title="城市与场馆足迹" description="离线摘要无需密钥；全国城市分享图会直接复用个人账号中已保存的高德 Web JS API Key，并固定为不可交互的全国视野。" />
            <label title="离线城市摘要无需 API；高德地图会真实加载 JS API，百度暂未接入足迹视图。">地图来源<select value={draft.map.provider} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, provider: event.target.value as AppSettings["map"]["provider"] } })}><option value="none">离线城市摘要（无需 API）</option><option value="amap">高德地图</option><option value="baidu">百度地图</option></select></label>
            {draft.map.provider === "amap" && <><label title="在高德开放平台创建 Web端（JS API）Key。">高德 Key<input type="password" value={draft.map.amapKey} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapKey: event.target.value } })} /></label><label title="高德 JS API 2.0 新 Key 通常需要同时配置安全密钥。">安全密钥<input type="password" value={draft.map.amapSecurityCode} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapSecurityCode: event.target.value } })} /></label></>}
            {draft.map.provider === "baidu" && <label title="在百度地图开放平台创建浏览器端应用并获取 AK。">百度 AK<input type="password" value={draft.map.baiduAk} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, baiduAk: event.target.value } })} /></label>}
            <div className="map-api-help-v2" title="鼠标悬停在地图来源、Key、AK 输入项上也能看到对应说明。">
              <strong>地图 API 获取说明</strong>
              <span>默认使用内置中国固定底图，无需密钥；需要可拖动缩放的在线底图时再申请相应浏览器端密钥。</span>
              <div>
                <a href="https://lbs.amap.com/api/javascript-api-v2/prerequisites" target="_blank" rel="noreferrer">获取高德 Key <ExternalLink /></a>
                <a href="https://lbsyun.baidu.com/index.php?title=jspopularGL1.0/guide/getkey" target="_blank" rel="noreferrer">获取百度 AK <ExternalLink /></a>
              </div>
            </div>
            <button className="button primary" type="button" onClick={() => void onSave(draft)}><MapIcon />保存地图设置</button>
          </section>

          <section className="settings-module storage-health-v2">
            <ModuleHeader eyebrow="状态" title="数据概况" description="查看当前设备和云端各保存了多少记录与图片。" />
            <Info label="有效记录" value={`${health.localRecords} 条`} />
            <Info label="图片附件" value={`${health.mediaAssets} 个`} />
            <Info label="仅本地图片" value={`${health.localOnlyMedia} 个`} />
            <Info label="云端图片" value={`${health.remoteMedia} 个`} />
            <Info label="最近完整同步" value={health.lastSyncAt ? new Date(health.lastSyncAt).toLocaleString("zh-CN") : "尚未同步"} />
          </section>

          <a className="github-project-card-v2" href={projectUrl()} target="_blank" rel="noreferrer"><Github /><span><strong>GitHub 项目主页</strong><small>查看源码、提交 Issue 或参与改进</small></span><ExternalLink /></a>
        </aside>
      </div>
    </section>
  );
}

export function GuestSettingsPage({ onLogin }: { onLogin: () => void }) {
  return <section className="guest-settings-v2"><span>示例模式</span><h2>这里显示的是 5 条演出示例。</h2><p>你可以切换视图、编辑或新增记录；关闭页面后这些修改会清空，也不会影响个人账号。</p><button className="button primary" type="button" onClick={onLogin}><ShieldCheck />返回账号登录</button></section>;
}

function ModuleHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="settings-module-header-v2"><div><span>{eyebrow}</span><h2>{title}</h2></div><p>{description}</p></header>;
}

function Info({ label, value }: { label: string; value: string }) { return <p className="settings-info-v2"><span>{label}</span><strong>{value}</strong></p>; }

function exportJson(records: EventRecord[]) { downloadBlob(JSON.stringify({ app: "live-memory", version: 3, exportedAt: nowIso(), records }, null, 2), `live-memory-${new Date().toISOString().slice(0, 10)}.json`, "application/json"); }
function exportText(records: EventRecord[]) { downloadBlob(JSON.stringify({ app: "live-memory", version: 3, mediaIncluded: false, exportedAt: nowIso(), records: records.map(withoutLocalMedia) }, null, 2), `live-memory-text-${new Date().toISOString().slice(0, 10)}.json`, "application/json"); }
function exportCsv(records: EventRecord[]) { const rows = [["title", "artists", "date", "city", "venue", "price", "status"]]; records.filter((record) => !record.deletedAt).forEach((record) => rows.push([record.title, record.artists.join("/"), record.date, record.city, record.venue, String(record.price || ""), record.status])); const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"); downloadBlob(`\ufeff${csv}`, `live-memory-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8"); }
