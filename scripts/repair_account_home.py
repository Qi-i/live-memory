from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


# ---------------------------------------------------------------------------
# Account client: use the same OAuth/session model as Submission Hub.
# ---------------------------------------------------------------------------
path = "src/supabase.ts"
text = read(path)
text = replace_once(
    text,
    'import { createClient, SupabaseClient } from "@supabase/supabase-js";',
    'import { createClient, SupabaseClient, type User } from "@supabase/supabase-js";',
    "supabase User import",
)
text = replace_once(
    text,
    '        storageKey: "live-memory-account-session",\n      },',
    '        storageKey: "live-memory-account-session",\n        detectSessionInUrl: true,\n        flowType: "pkce",\n      },',
    "account auth configuration",
)
text = replace_between(
    text,
    "function currentAppUrl() {",
    "\n\nexport interface AccountSignInResult",
    '''function oauthRedirectUrl() {
  if (typeof window === "undefined") return undefined;
  const base = import.meta.env.BASE_URL || "/";
  return new URL(base, window.location.origin).toString();
}''',
    "OAuth redirect helper",
)
text = replace_once(
    text,
    '  if (isEmailRateLimit(error)) throw new Error("账号请求过于频繁，请稍后再试。");\n  throw new Error("用户名或密码不正确。新用户请先选择“创建新账号”。");',
    '  if (isEmailRateLimit(error)) throw new Error("登录尝试过于频繁，请稍后再试。");\n  if (/failed to fetch|network|connection|load failed|closed/i.test(error.message || "")) {\n    throw new Error("暂时无法连接账号服务，请刷新页面后重试。");\n  }\n  throw new Error("用户名或密码不正确。");',
    "password sign-in errors",
)
old_github = '''export async function signInWithGithub(settings: AppSettings) {
  const client = makeAccountClient(settings);
  const { error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: currentAppUrl(),
    },
  });
  if (error) throw error;
  return "正在跳转到 GitHub 授权";
}
'''
new_github = '''export async function signInWithGithub(settings: AppSettings) {
  const client = makeAccountClient(settings);
  const redirectTo = oauthRedirectUrl();
  const { error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
  return "正在前往 GitHub 登录";
}

export async function linkGithubIdentity(settings: AppSettings) {
  const client = makeAccountClient(settings);
  const redirectTo = oauthRedirectUrl();
  const { error } = await client.auth.linkIdentity({
    provider: "github",
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
  return "正在前往 GitHub 完成绑定";
}

export async function getLinkedProviders(settings: AppSettings) {
  const client = makeAccountClient(settings);
  const { data, error } = await client.auth.getUserIdentities();
  if (error) throw error;
  return Array.from(new Set((data.identities || []).map((identity) => identity.provider)));
}

export function watchAccountAuth(settings: AppSettings, callback: (user: User | null) => void) {
  const client = makeAccountClient(settings);
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
  return () => subscription.unsubscribe();
}
'''
text = replace_once(text, old_github, new_github, "GitHub auth functions")
write(path, text)


# ---------------------------------------------------------------------------
# Guest mode: demo records live only in React memory and never touch IndexedDB.
# ---------------------------------------------------------------------------
path = "src/appController.ts"
text = read(path)
text = replace_once(
    text,
    'import { useAccess } from "./access";',
    'import { makeGuestSettings, useAccess } from "./access";',
    "guest settings import",
)
text = replace_once(
    text,
    'import type { AppRoute } from "./experience";',
    'import type { AppRoute } from "./experience";\nimport { seedRecords } from "./seeds";',
    "guest records import",
)
helper_marker = '''function mediaPathFingerprint(records: EventRecord[]) {
  return records.flatMap((record) => record.media.filter((asset) => asset.storagePath).map((asset) => `${record.id}:${asset.id}:${asset.storagePath}`)).join("|");
}
'''
helper = helper_marker + '''
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
'''
text = replace_once(text, helper_marker, helper, "guest clone helper")
init_start = '''  useEffect(() => {
    let active = true;
    initialized.current = false;
    Promise.all([loadRecordsWithMigration(), Promise.resolve(readSettings())])'''
init_end = '''

  const activeRecords = useMemo'''
init_replacement = '''  useEffect(() => {
    let active = true;
    initialized.current = false;

    if (isGuest) {
      const demoRecords = guestDemoRecords();
      const guestSettings = makeGuestSettings();
      recordsRef.current = demoRecords;
      setRecordState(demoRecords);
      setSettings(guestSettings);
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
            await replaceAllRecords(nextRecords);
          } catch {
            nextSettings = writeSettings({ ...loadedSettings, onboardingComplete: true });
          }
        }
        if (!active) return;
        recordsRef.current = nextRecords;
        setRecordState(nextRecords);
        setSettings(nextSettings);
        lastSyncFingerprint.current = recordFingerprint(nextRecords);
        initialized.current = true;
      })
      .catch((error) => {
        if (!active) return;
        setToast(friendlySupabaseErrorMessage(error, "本机记录加载失败"));
        initialized.current = true;
      });
    return () => { active = false; };
  }, [access.mode, access.user, isGuest]);'''
text = replace_between(text, init_start, init_end, init_replacement, "guest initialization")

text = replace_between(
    text,
    "  async function persistRecord(record: EventRecord) {",
    "\n\n  async function moveToTrash",
    '''  async function persistRecord(record: EventRecord) {
    const nextRecord = { ...record, updatedAt: nowIso() };
    const saved = isGuest ? nextRecord : await saveRecord(nextRecord);
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(saved);
    setEditing(null);
    flash(isGuest ? "已更新示例（关闭页面后不会保留）" : "已保存");
    return saved;
  }''',
    "guest save",
)
text = replace_between(
    text,
    "  async function moveToTrash(record: EventRecord) {",
    "\n\n  async function restoreRecord",
    '''  async function moveToTrash(record: EventRecord) {
    const nextRecord = { ...record, deletedAt: nowIso(), updatedAt: nowIso() };
    const saved = isGuest ? nextRecord : await saveRecord(nextRecord);
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    setSelected(null);
    flash(isGuest ? "已从当前示例中移除" : "已移入回收站");
  }''',
    "guest trash",
)
text = replace_between(
    text,
    "  async function restoreRecord(record: EventRecord) {",
    "\n\n  async function permanentlyDeleteRecord",
    '''  async function restoreRecord(record: EventRecord) {
    const nextRecord = { ...record, deletedAt: undefined, updatedAt: nowIso() };
    const saved = isGuest ? nextRecord : await saveRecord(nextRecord);
    setRecords((current) => current.filter((item) => item.id !== saved.id).concat(saved));
    flash("记录已恢复");
  }''',
    "guest restore",
)
text = replace_between(
    text,
    "  async function permanentlyDeleteRecord(record: EventRecord) {",
    "\n\n  async function updateSettings",
    '''  async function permanentlyDeleteRecord(record: EventRecord) {
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
  }''',
    "guest permanent delete",
)
text = replace_between(
    text,
    "  async function updateSettings(next: AppSettings, message = \"设置已保存\") {",
    "\n\n  async function replaceRecords",
    '''  async function updateSettings(next: AppSettings, message = "设置已保存") {
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
  }''',
    "guest settings",
)
text = replace_between(
    text,
    "  async function replaceRecords(next: EventRecord[], message: string) {",
    "\n\n  return {",
    '''  async function replaceRecords(next: EventRecord[], message: string) {
    if (!isGuest) await replaceAllRecords(next);
    setRecords(next);
    flash(message);
  }''',
    "guest bulk replace",
)
write(path, text)


# ---------------------------------------------------------------------------
# Settings: clear user guidance and identity linking.
# ---------------------------------------------------------------------------
path = "src/settingsPage.tsx"
text = read(path)
text = replace_once(
    text,
    "  friendlySupabaseErrorMessage,\n  hasPersonalCloudConnection,",
    "  friendlySupabaseErrorMessage,\n  getLinkedProviders,\n  hasPersonalCloudConnection,",
    "linked provider import",
)
text = replace_once(
    text,
    "  hasSupabaseConfig,\n  pullRecordsFromSupabase,",
    "  hasSupabaseConfig,\n  linkGithubIdentity,\n  pullRecordsFromSupabase,",
    "link identity import",
)
text = replace_once(
    text,
    '  const [password, setPassword] = useState("");\n  useEffect(() => setDraft(settings), [settings]);',
    '  const [password, setPassword] = useState("");\n  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);\n  useEffect(() => setDraft(settings), [settings]);\n  useEffect(() => {\n    let active = true;\n    getLinkedProviders(settings)\n      .then((providers) => { if (active) setLinkedProviders(providers); })\n      .catch(() => undefined);\n    return () => { active = false; };\n  }, [settings.account.username]);',
    "linked providers state",
)
text = replace_once(
    text,
    "  const trashRecords = records.filter((record) => record.deletedAt);",
    '  const trashRecords = records.filter((record) => record.deletedAt);\n  const githubLinked = linkedProviders.includes("github");',
    "GitHub linked flag",
)
text = text.replace(
    'title="Live Memory 账号" description="登录状态由应用入口统一管理；设置页只负责资料、密码和退出。"',
    'title="现场记账号" description="查看个人资料、登录方式和密码设置。"',
)
old_buttons = '''              <button className="button ghost" type="button" disabled={busy || !password} onClick={() => void run(async () => { await updateAccountPassword(draft, password); setPassword(""); flash("密码已更新"); })}><ShieldCheck />更新密码</button>
              <button className="button ghost" type="button" disabled={busy} onClick={() => void run(onSignOut)}>退出账号</button>'''
new_buttons = '''              <button className="button ghost" type="button" disabled={busy || !password} onClick={() => void run(async () => { await updateAccountPassword(draft, password); setPassword(""); flash("密码已更新"); })}><ShieldCheck />更新密码</button>
              <button className="button ghost" type="button" disabled={busy || githubLinked} title="绑定后可使用同一个账号的用户名密码或 GitHub 登录" onClick={() => void run(async () => { await linkGithubIdentity(draft); })}><Github />{githubLinked ? "GitHub 已绑定" : "绑定 GitHub"}</button>
              <button className="button ghost" type="button" disabled={busy} onClick={() => void run(onSignOut)}>退出账号</button>'''
text = replace_once(text, old_buttons, new_buttons, "account action buttons")
text = text.replace(
    'description="账号负责身份；你的 Supabase 项目负责演出文字和图片的完整跨设备同步。"',
    'description="连接自己的 Supabase 后，文字和图片可以在电脑与手机之间同步。"',
)
text = text.replace('<label>项目 URL<input ', '<label title="在 Supabase 项目设置的 API 页面复制 Project URL">项目 URL<input ')
text = text.replace('<label>anon / publishable key<input ', '<label title="只填写 anon 或 publishable key，不要填写 service_role 或数据库密码">anon / publishable key<input ')
text = text.replace('<label>图片空间<input ', '<label title="用于存放海报、票根和照片；默认名称为 echo-media">图片空间<input ')
cloud_actions = '''            <div className="settings-actions-v2">
              <button className="button primary" type="button" disabled={busy || !cloudReady}'''
cloud_actions_replacement = '''            <p className="settings-help-v2">项目 URL 和公开密钥可在 Supabase 的 Project Settings → API 中找到。这里只能填写 anon 或 publishable key。</p>
            <div className="settings-actions-v2">
              <button className="button primary" type="button" disabled={busy || !cloudReady}'''
text = replace_once(text, cloud_actions, cloud_actions_replacement, "Supabase help text")
text = text.replace(
    'title="导出、导入与回收站" description="备份操作集中在一个模块，避免同一功能散落在多个卡片。"',
    'title="导出、导入与回收站" description="可导出备份、恢复记录或处理已删除内容。"',
)
text = text.replace(
    'title="数据健康检查" description="当前设备与个人云端的实际数据量。"',
    'title="数据概况" description="查看当前设备和云端各保存了多少记录与图片。"',
)
old_guest = 'return <section className="guest-settings-v2"><span>访客临时模式</span><h2>正式档案没有被读取。</h2><p>访客新增和编辑的数据只存在于当前标签页的内存中；关闭页面后清空，也不会连接账号或个人 Supabase。</p>'
new_guest = 'return <section className="guest-settings-v2"><span>示例模式</span><h2>这里显示的是 5 条演出示例。</h2><p>你可以切换视图、编辑或新增记录；关闭页面后这些修改会清空，也不会影响个人账号。</p>'
text = replace_once(text, old_guest, new_guest, "guest settings copy")
write(path, text)

path = "src/settingsPage.css"
text = read(path)
if ".settings-help-v2" not in text:
    text += "\n.settings-help-v2 { margin: 10px 0 0; color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1.55; }\n"
write(path, text)


# ---------------------------------------------------------------------------
# Human-facing product name and plain-language labels.
# ---------------------------------------------------------------------------
path = "src/experience.tsx"
text = read(path)
replacements = {
    'archive: { label: "档案", description: "浏览、整理与分享你的演出记忆"': 'archive: { label: "档案", description: "浏览和整理演出记录"',
    'stats: { label: "统计", description: "从城市、艺人、时间与票价理解你的观演轨迹"': 'stats: { label: "统计", description: "查看城市、艺人、时间和票价统计"',
    'settings: { label: "设置", description: "管理账号、同步、显示与本地数据"': 'settings: { label: "设置", description: "管理账号、同步和显示方式"',
    'admin: { label: "管理", description: "查看服务运行与用户数据概况"': 'admin: { label: "管理", description: "查看账号和服务使用情况"',
    '<strong>回响册</strong>': '<strong>现场记</strong>',
    '<small>Live Memory</small>': '<small>演出记录</small>',
    '<span>外观系统</span>': '<span>外观</span>',
    '<h2>主题与阅读模式</h2>': '<h2>页面风格</h2>',
    '<p>明暗模式与视觉主题独立设置，并自动适配移动端和分享画布。</p>': '<p>选择明暗模式和页面风格，手机端与分享图会自动适配。</p>',
    '<span><b>Aurora</b><small>轻盈、通透、适合高密度档案浏览</small></span>': '<span><b>清透</b><small>留白更轻，适合日常浏览</small></span>',
    '<span><b>Editorial</b><small>纸张感与强排版，适合截图与传播</small></span>': '<span><b>画册</b><small>排版更突出，适合截图分享</small></span>',
}
for old, new in replacements.items():
    text = text.replace(old, new)
write(path, text)

path = "src/AppRoot.tsx"
text = read(path)
text = text.replace('"访客临时数据"', '"示例数据"')
text = text.replace('|| "Live Memory"', '|| "现场记"')
write(path, text)

path = "src/archive.tsx"
text = read(path)
text = text.replace('<span>LIVE MEMORY ARCHIVE</span>', '<span>我的演出记录</span>')
text = text.replace('<h2>让每一次现场，都有清晰的位置。</h2>', '<h2>把看过和想看的演出放在一起。</h2>')
text = text.replace('<p>海报负责第一眼，票根保留细节，时间线连接记忆。布局切换只改变阅读方式，不改变你的数据。</p>', '<p>可以按海报、票根、时间、城市或票价查看，视图随时切换。</p>')
text = text.replace("分享画布", "生成分享图")
text = text.replace("回响册", "现场记")
text = text.replace("LIVE MEMORY", "现场记")
write(path, text)

path = "index.html"
text = read(path)
text = text.replace("回响册 Live Memory", "现场记｜演出记录与票根收藏")
text = text.replace("回响册", "现场记")
write(path, text)

path = "public/manifest.webmanifest"
text = read(path)
text = text.replace("回响册 Live Memory", "现场记")
text = text.replace("回响册", "现场记")
write(path, text)

# Match actual bundled image formats.
for path in ("src/access.tsx", "src/seeds.ts"):
    text = read(path)
    text = text.replace("zhou-shen.jpg", "zhou-shen.webp")
    text = text.replace("xue-zhiqian.jpg", "xue-zhiqian.webp")
    text = text.replace("zhao-lei.jpg", "zhao-lei.png")
    write(path, text)

# User-visible strings must describe actions, not internal implementation boundaries.
banned = [
    "明确身份",
    "正式档案没有被读取",
    "不接触正式档案",
    "应用入口统一管理",
    "LIVE MEMORY SAMPLE",
]
for path in Path("src").glob("*.tsx"):
    text = read(str(path))
    for phrase in banned:
        if phrase in text:
            raise RuntimeError(f"user-facing internal phrase remains in {path}: {phrase}")

print("Account, guest, homepage and wording repair applied.")
