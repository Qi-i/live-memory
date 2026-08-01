import {
  Check,
  Clipboard,
  Cloud,
  Github,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppSettings, EventRecord } from "./domain";
import { categoryLabels } from "./domain";
import {
  fetchAdminUsers,
  resetAdminUserPassword,
  updateAdminUserProfile,
  type AdminUserProfileInput,
  type AdminUserRecord,
} from "./adminApi";
import "./refinementV3.css";
import "./refinementV3Hotfix.css";
import "./refinementV3Hotfix.css";

export function StatsPage({ records }: { records: EventRecord[] }) {
  const watched = records.filter((record) => record.status === "watched");
  const planned = records.filter((record) => record.status !== "watched");
  const totalPrice = watched.reduce((sum, record) => sum + (record.price || 0), 0);
  const averagePrice = Math.round(totalPrice / Math.max(1, watched.filter((record) => record.price).length));
  const years = unique(records.map((record) => record.date.slice(0, 4))).sort();
  const monthly = useMemo(() => countRows(watched.map((record) => record.date.slice(0, 7)), 12), [watched]);
  const artists = useMemo(() => countRows(records.flatMap((record) => record.artists), 10), [records]);
  const cities = useMemo(() => countRows(records.map((record) => record.city).filter(Boolean), 10), [records]);
  const categories = useMemo(() => countRows(records.map((record) => categoryLabels[record.category]), 10), [records]);

  return (
    <section className="statistics-page">
      <div className="statistics-metrics">
        <Metric value={records.length} label="总记录" hint={years.length ? `${years[0]}—${years[years.length - 1]}` : "尚无档案"} />
        <Metric value={watched.length} label="已看" hint="完成观演" accent />
        <Metric value={planned.length} label="待看/想看" hint="未来计划" />
        <Metric value={`¥${totalPrice}`} label="累计票价" hint={`均价 ¥${averagePrice || 0}`} accent />
      </div>

      <div className="statistics-grid">
        <BarPanel title="每月观演" description="最近 12 个有记录的月份" rows={monthly} />
        <BarPanel title="常看艺人" description="按档案出现次数统计" rows={artists} />
        <BarPanel title="城市足迹" description="现场发生在哪些城市" rows={cities} />
        <BarPanel title="演出类型" description="档案类型结构" rows={categories} />
      </div>

      <section className="statistics-story">
        <span>MEMORY PROFILE</span>
        <h2>{profileSentence(records, watched, cities, artists)}</h2>
        <p>统计页只解释你的档案，不重复档案页的筛选和导航。所有数据均来自当前记录。</p>
      </section>
    </section>
  );
}

function Metric({ value, label, hint, accent }: { value: string | number; label: string; hint: string; accent?: boolean }) {
  return <article className={accent ? "is-accent" : ""}><span>{label}</span><strong>{value}</strong><em>{hint}</em></article>;
}

function BarPanel({ title, description, rows }: { title: string; description: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return (
    <article className="statistics-panel">
      <header><span>{description}</span><h2>{title}</h2></header>
      <div>{rows.length ? rows.map(([label, count]) => <p key={label}><span>{label}</span><i><b style={{ width: `${count / max * 100}%` }} /></i><strong>{count}</strong></p>) : <em className="statistics-empty">暂无可统计数据</em>}</div>
    </article>
  );
}

function profileSentence(records: EventRecord[], watched: EventRecord[], cities: [string, number][], artists: [string, number][]) {
  if (!records.length) return "你的现场画像会随着档案逐渐形成。";
  const city = cities[0]?.[0] || "不同城市";
  const artist = artists[0]?.[0] || "不同艺人";
  return `你已经完成 ${watched.length} 次演出记录，最常抵达 ${city}，档案中出现最多的是 ${artist}。`;
}

export function AdminPage({ settings }: { settings: AppSettings }) {
  void settings;
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AdminUserRecord | null>(null);
  const [editForm, setEditForm] = useState<AdminUserProfileInput>({ username: "", displayName: "", nickname: "", recoveryEmail: "" });
  const [resettingUser, setResettingUser] = useState<AdminUserRecord | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      setUsers(await fetchAdminUsers());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "用户信息加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => [
      user.displayName,
      user.nickname,
      user.username,
      user.email,
      user.recoveryEmail,
      user.githubUsername,
      user.id,
    ].some((value) => value.toLowerCase().includes(needle)));
  }, [query, users]);

  const providerUsers = users.filter((user) => user.providers.includes("github")).length;
  const cloudUsers = users.filter((user) => user.linkedCloud).length;
  const totalRecords = users.reduce((sum, user) => sum + user.recordCount, 0);

  function openEdit(user: AdminUserRecord) {
    setActionMessage("");
    setEditing(user);
    setEditForm({
      username: user.username,
      displayName: user.displayName,
      nickname: user.nickname,
      recoveryEmail: user.recoveryEmail,
    });
  }

  async function saveProfile() {
    if (!editing || busy) return;
    setBusy(true);
    setActionMessage("");
    try {
      await updateAdminUserProfile(editing.id, editForm);
      setActionMessage("用户资料已更新");
      await loadUsers();
      setEditing(null);
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : "资料更新失败");
    } finally {
      setBusy(false);
    }
  }

  function openReset(user: AdminUserRecord) {
    setActionMessage("");
    setResettingUser(user);
    setNewPassword(generatePassword());
  }

  async function resetPassword() {
    if (!resettingUser || busy || newPassword.length < 10) return;
    setBusy(true);
    setActionMessage("");
    try {
      await resetAdminUserPassword(resettingUser.id, newPassword);
      setActionMessage("密码已重置。请通过安全渠道告知用户。 ");
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : "密码重置失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="admin-state"><Loader2 className="spin" /><strong>正在读取用户信息</strong><span>正在核对账号、登录方式和文字备份。</span></section>;
  if (error) return <section className="admin-state is-error"><strong>管理页面暂不可用</strong><p>{error}</p><button type="button" onClick={() => void loadUsers()}><RefreshCw />重新加载</button></section>;

  return (
    <section className="admin-console">
      <header className="admin-console-header">
        <div>
          <span><ShieldCheck />账号管理</span>
          <h2>用户与账号状态</h2>
          <p>查看注册信息、登录方式、最近登录、文字备份与个人云端连接状态；敏感密钥不会在这里显示。</p>
        </div>
        <button type="button" onClick={() => void loadUsers()}><RefreshCw />刷新数据</button>
      </header>

      <div className="admin-summary-grid">
        <AdminSummary value={users.length} label="注册用户" hint={`${users.filter((user) => user.isAdmin).length} 位管理员`} />
        <AdminSummary value={providerUsers} label="GitHub 登录" hint="已绑定身份" />
        <AdminSummary value={cloudUsers} label="个人云端" hint="已保存连接" />
        <AdminSummary value={totalRecords} label="文字备份" hint="账号云端记录" />
      </div>

      <div className="admin-user-toolbar">
        <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、用户名、邮箱、GitHub 或用户 ID" />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}><X /></button>}</label>
        <span>显示 {filteredUsers.length} / {users.length} 位用户</span>
      </div>

      <div className="admin-user-table" role="table" aria-label="注册用户列表">
        <div className="admin-user-table-head" role="row">
          <span>用户</span><span>登录与联系</span><span>使用情况</span><span>时间</span><span>操作</span>
        </div>
        {filteredUsers.map((user) => (
          <article className="admin-user-row" role="row" key={user.id}>
            <div className="admin-user-identity">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <i>{(user.displayName || user.username || "?").slice(0, 1).toUpperCase()}</i>}
              <span>
                <strong>{user.displayName || user.nickname || user.username || "未命名用户"}{user.isAdmin && <em>管理员</em>}</strong>
                <small>@{user.username || "未设置"}</small>
                <button type="button" title="复制用户 ID" onClick={() => void navigator.clipboard.writeText(user.id)}><Clipboard />{shortId(user.id)}</button>
              </span>
            </div>

            <div className="admin-user-login">
              <span><Mail />{user.recoveryEmail || user.email || "未设置联系邮箱"}</span>
              <div>{user.providers.length ? user.providers.map((provider) => <b key={provider}>{provider === "github" ? <Github /> : <UserRound />}{providerLabel(provider)}</b>) : <b><UserRound />密码账号</b>}</div>
              {user.githubUsername && <small>GitHub：@{user.githubUsername}</small>}
            </div>

            <div className="admin-user-usage">
              <strong>{user.recordCount}<span>条文字备份</span></strong>
              <b className={user.linkedCloud ? "is-connected" : ""}><Cloud />{user.linkedCloud ? `已连接 · ${user.mediaBucket}` : "未连接个人云端"}</b>
              <small>{user.syncMedia ? "同步图片已开启" : "同步图片未开启"}</small>
            </div>

            <div className="admin-user-time">
              <span>注册 {formatAdminDate(user.createdAt)}</span>
              <span>登录 {formatAdminDate(user.lastSignInAt)}</span>
              <small>{user.confirmedAt ? "账号已确认" : "账号未确认"}</small>
            </div>

            <div className="admin-user-actions">
              <button type="button" title="编辑公开资料与备用邮箱" onClick={() => openEdit(user)}><Pencil />编辑</button>
              <button type="button" title="直接设置新的登录密码" onClick={() => openReset(user)}><KeyRound />重置密码</button>
            </div>
          </article>
        ))}
        {!filteredUsers.length && <div className="admin-user-empty">没有符合当前搜索条件的用户。</div>}
      </div>

      {editing && (
        <div className="admin-modal-backdrop" onMouseDown={() => !busy && setEditing(null)}>
          <section className="admin-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>编辑用户</span><h3>{editing.displayName || editing.username}</h3></div><button type="button" aria-label="关闭" disabled={busy} onClick={() => setEditing(null)}><X /></button></header>
            <div className="admin-form-grid">
              <label><span>用户名</span><input value={editForm.username} onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value.toLowerCase() }))} placeholder="4–32 位小写字母或数字" /></label>
              <label><span>显示名称</span><input value={editForm.displayName} onChange={(event) => setEditForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
              <label><span>昵称</span><input value={editForm.nickname} onChange={(event) => setEditForm((current) => ({ ...current, nickname: event.target.value }))} /></label>
              <label><span>备用邮箱</span><input type="email" value={editForm.recoveryEmail} onChange={(event) => setEditForm((current) => ({ ...current, recoveryEmail: event.target.value }))} placeholder="用于核对身份，不公开显示" /></label>
            </div>
            {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
            <footer><button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="is-primary" type="button" disabled={busy || editForm.username.length < 4} onClick={() => void saveProfile()}>{busy ? <Loader2 className="spin" /> : <Check />}保存资料</button></footer>
          </section>
        </div>
      )}

      {resettingUser && (
        <div className="admin-modal-backdrop" onMouseDown={() => !busy && setResettingUser(null)}>
          <section className="admin-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>重置密码</span><h3>{resettingUser.displayName || resettingUser.username}</h3></div><button type="button" aria-label="关闭" disabled={busy} onClick={() => setResettingUser(null)}><X /></button></header>
            <p className="admin-modal-note">这是直接修改账号密码的管理操作。系统不会把新密码自动发送给用户。</p>
            <label className="admin-password-field"><span>新密码</span><div><input type="text" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} maxLength={128} /><button type="button" onClick={() => setNewPassword(generatePassword())}>重新生成</button><button type="button" onClick={() => void navigator.clipboard.writeText(newPassword)}><Clipboard />复制</button></div><small>至少 10 位，建议使用系统生成的随机密码。</small></label>
            {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
            <footer><button type="button" disabled={busy} onClick={() => setResettingUser(null)}>关闭</button><button className="is-primary" type="button" disabled={busy || newPassword.length < 10} onClick={() => void resetPassword()}>{busy ? <Loader2 className="spin" /> : <KeyRound />}确认重置</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}

function AdminSummary({ value, label, hint }: { value: number; label: string; hint: string }) {
  return <article><strong>{value}</strong><span>{label}</span><small>{hint}</small></article>;
}

function providerLabel(provider: string) {
  if (provider === "github") return "GitHub";
  if (provider === "email") return "密码";
  return provider;
}

function shortId(id: string) {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function formatAdminDate(value: string) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const values = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function countRows(values: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function unique<T extends string>(values: T[]) { return Array.from(new Set(values.filter(Boolean))); }
