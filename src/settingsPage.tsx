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
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, ArchiveView, EventRecord } from "./domain";
import { viewLabels } from "./domain";
import { fileToAvatar, downloadBlob, nowIso } from "./media";
import { normalizeRecord, replaceAllRecords } from "./storage";
import {
  friendlySupabaseErrorMessage,
  hasPersonalCloudConnection,
  hasSupabaseConfig,
  pullRecordsFromSupabase,
  pushRecordsToSupabase,
  refreshSignedMediaUrls,
  signInStorageWithAccount,
  updateAccountPassword,
} from "./supabase";
import { ThemeSettingsPanel, projectUrl } from "./experience";
import { withoutLocalMedia } from "./syncModel";

interface SettingsPageProps {
  settings: AppSettings;
  records: EventRecord[];
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
  useEffect(() => setDraft(settings), [settings]);
  const cloudReady = hasSupabaseConfig(draft);
  const cloudConnected = hasPersonalCloudConnection(draft);
  const trashRecords = records.filter((record) => record.deletedAt);

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

  async function uploadCloud() {
    const result = await pushRecordsToSupabase(draft, records);
    await replaceAllRecords(result.records);
    setRecords(result.records);
    const next = { ...draft, lastSyncAt: nowIso() };
    setDraft(next);
    await onSave(next, result.message);
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

  async function importBackup(file?: File) {
    if (!file) return;
    const parsed = JSON.parse(await file.text()) as { records?: unknown[] } | unknown[];
    const rows = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(rows)) throw new Error("备份文件格式不正确");
    const next = rows.map((row) => normalizeRecord(row as EventRecord));
    await replaceAllRecords(next);
    setRecords(next);
    flash(`已导入 ${next.length} 条记录`);
  }

  return (
    <section className="settings-page-v2">
      <ThemeSettingsPanel />

      <div className="settings-layout-v2">
        <div className="settings-main-v2">
          <section className="settings-module account-module-v2">
            <ModuleHeader eyebrow="账号" title="Live Memory 账号" description="登录状态由应用入口统一管理；设置页只负责资料、密码和退出。" />
            <div className="account-profile-v2">
              <div className="account-avatar-preview-v2">
                <span>{draft.account.avatarUrl ? <img src={draft.account.avatarUrl} alt={draft.account.nickname} /> : draft.account.nickname.slice(0, 1).toUpperCase()}</span>
                <strong>{draft.account.nickname || draft.account.username}</strong>
                <small>@{draft.account.username}</small>
              </div>
              <div className="settings-fields-v2">
                <label>昵称<input value={draft.account.nickname} onChange={(event) => setDraft({ ...draft, account: { ...draft.account, nickname: event.target.value } })} /></label>
                <label>用户名<input value={draft.account.username} disabled title="用户名与账号身份绑定，不在此处直接修改" /></label>
                <label className="avatar-picker-v2">头像<span><ImagePlus />{draft.account.avatarUrl ? "更换头像" : "选择头像"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectAvatar(event.target.files?.[0])} /></label>
                <label>备用邮箱<input type="email" value={draft.account.recoveryEmail} onChange={(event) => setDraft({ ...draft, account: { ...draft.account, recoveryEmail: event.target.value } })} placeholder="用于身份核对和密码恢复" /></label>
              </div>
            </div>
            <div className="settings-actions-v2">
              <button className="button primary" type="button" disabled={busy} onClick={() => void onSave(draft)}><Check />保存账号资料</button>
              <label className="inline-password-v2">新密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label>
              <button className="button ghost" type="button" disabled={busy || !password} onClick={() => void run(async () => { await updateAccountPassword(draft, password); setPassword(""); flash("密码已更新"); })}><ShieldCheck />更新密码</button>
              <button className="button ghost" type="button" disabled={busy} onClick={() => void run(onSignOut)}>退出账号</button>
            </div>
          </section>

          <section className="settings-module cloud-module-v2">
            <ModuleHeader eyebrow="同步" title="个人 Supabase" description="账号负责身份；你的 Supabase 项目负责演出文字和图片的完整跨设备同步。" />
            <div className="cloud-status-v2">
              <span className={cloudConnected ? "is-connected" : ""}><i />{cloudConnected ? "个人云端已连接" : cloudReady ? "配置已保存，等待连接" : "尚未填写连接信息"}</span>
              <strong>{health.remoteMedia} 个云端图片</strong>
            </div>
            <div className="settings-fields-v2 settings-fields-two-v2">
              <label>项目 URL<input value={draft.supabase.url} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, url: event.target.value, ownerKey: "" } })} placeholder="https://xxxx.supabase.co" /></label>
              <label>anon / publishable key<input type="password" value={draft.supabase.anonKey} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, anonKey: event.target.value, ownerKey: "" } })} /></label>
              <label>图片空间<input value={draft.supabase.mediaBucket} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, mediaBucket: event.target.value } })} placeholder="echo-media" /></label>
              <label className="toggle-field-v2"><input type="checkbox" checked={draft.supabase.syncMedia} onChange={(event) => setDraft({ ...draft, supabase: { ...draft.supabase, syncMedia: event.target.checked } })} /><span><strong>同步图片</strong><small>海报、票根、座位图和现场照片</small></span></label>
            </div>
            <div className="settings-actions-v2">
              <button className="button primary" type="button" disabled={busy || !cloudReady} onClick={() => void run(connectPersonalCloud)}>{busy ? <Loader2 className="spin" /> : <ShieldCheck />}{cloudConnected ? "重新连接" : "连接个人云端"}</button>
              <button className="button ghost" type="button" disabled={busy || !cloudConnected} onClick={() => void run(uploadCloud)}><Upload />上传当前档案</button>
              <button className="button ghost" type="button" disabled={busy || !cloudConnected} onClick={() => void run(restoreCloud)}><Download />从云端恢复</button>
              <button className="button ghost" type="button" disabled={busy || !cloudConnected || !draft.supabase.syncMedia} onClick={() => void run(refreshCloudMedia)}><RefreshCw />刷新图片链接</button>
              <button className="button ghost" type="button" onClick={() => void onSave(draft)}><Check />保存连接设置</button>
            </div>
          </section>

          <section className="settings-module data-module-v2">
            <ModuleHeader eyebrow="数据" title="导出、导入与回收站" description="备份操作集中在一个模块，避免同一功能散落在多个卡片。" />
            <div className="data-action-grid-v2">
              <button type="button" onClick={() => exportJson(records)}><Download /><span><strong>完整 JSON</strong><small>包含当前图片数据</small></span></button>
              <button type="button" onClick={() => exportText(records)}><Download /><span><strong>文字备份</strong><small>不包含本地图片</small></span></button>
              <button type="button" onClick={() => exportCsv(records)}><Download /><span><strong>CSV 表格</strong><small>便于统计和整理</small></span></button>
              <label><Upload /><span><strong>导入 JSON</strong><small>恢复或迁移档案</small></span><input type="file" accept="application/json" onChange={(event) => void run(() => importBackup(event.target.files?.[0]))} /></label>
            </div>
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
            <ModuleHeader eyebrow="地图" title="城市与场馆足迹" description="地图密钥只在启用真实在线地图时需要。" />
            <label>地图来源<select value={draft.map.provider} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, provider: event.target.value as AppSettings["map"]["provider"] } })}><option value="none">统计式足迹图</option><option value="amap">高德地图</option><option value="baidu">百度地图</option></select></label>
            {draft.map.provider === "amap" && <><label>高德 Key<input type="password" value={draft.map.amapKey} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapKey: event.target.value } })} /></label><label>安全密钥<input type="password" value={draft.map.amapSecurityCode} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, amapSecurityCode: event.target.value } })} /></label></>}
            {draft.map.provider === "baidu" && <label>百度 AK<input type="password" value={draft.map.baiduAk} onChange={(event) => setDraft({ ...draft, map: { ...draft.map, baiduAk: event.target.value } })} /></label>}
            <button className="button primary" type="button" onClick={() => void onSave(draft)}><MapIcon />保存地图设置</button>
          </section>

          <section className="settings-module storage-health-v2">
            <ModuleHeader eyebrow="状态" title="数据健康检查" description="当前设备与个人云端的实际数据量。" />
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
  return <section className="guest-settings-v2"><span>访客临时模式</span><h2>正式档案没有被读取。</h2><p>访客新增和编辑的数据只存在于当前标签页的内存中；关闭页面后清空，也不会连接账号或个人 Supabase。</p><button className="button primary" type="button" onClick={onLogin}><ShieldCheck />返回账号登录</button></section>;
}

function ModuleHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="settings-module-header-v2"><div><span>{eyebrow}</span><h2>{title}</h2></div><p>{description}</p></header>;
}

function Info({ label, value }: { label: string; value: string }) { return <p className="settings-info-v2"><span>{label}</span><strong>{value}</strong></p>; }

function exportJson(records: EventRecord[]) { downloadBlob(JSON.stringify({ app: "live-memory", version: 3, exportedAt: nowIso(), records }, null, 2), `live-memory-${new Date().toISOString().slice(0, 10)}.json`, "application/json"); }
function exportText(records: EventRecord[]) { downloadBlob(JSON.stringify({ app: "live-memory", version: 3, mediaIncluded: false, exportedAt: nowIso(), records: records.map(withoutLocalMedia) }, null, 2), `live-memory-text-${new Date().toISOString().slice(0, 10)}.json`, "application/json"); }
function exportCsv(records: EventRecord[]) { const rows = [["title", "artists", "date", "city", "venue", "price", "status"]]; records.filter((record) => !record.deletedAt).forEach((record) => rows.push([record.title, record.artists.join("/"), record.date, record.city, record.venue, String(record.price || ""), record.status])); const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"); downloadBlob(`\ufeff${csv}`, `live-memory-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8"); }
