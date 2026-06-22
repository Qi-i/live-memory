import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  AppSettings,
  EventRecord,
  MediaAsset,
  validatePassword,
  validateRecoveryEmail,
  validateUsername,
} from "./domain";
import { dataUrlToBlob, nowIso } from "./media";
import { normalizeRecord } from "./storage";
import { mergeTextBackup, withoutLocalMedia } from "./syncModel";

function mediaBucket(settings: AppSettings) {
  return settings.supabase.mediaBucket || import.meta.env.VITE_SUPABASE_MEDIA_BUCKET || "echo-media";
}

export interface SyncResult {
  records: EventRecord[];
  message: string;
}

const accountUrl = import.meta.env.VITE_ACCOUNT_SUPABASE_URL || "";
const accountAnonKey = import.meta.env.VITE_ACCOUNT_SUPABASE_ANON_KEY || "";
const ownerHeader = "x-live-memory-owner-key";

export interface UserProfileBinding {
  displayName: string;
  username: string;
  nickname: string;
  avatarUrl: string;
  recoveryEmail: string;
  githubUsername: string;
  githubUserId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  mediaBucket: string;
  amapKey: string;
  preferences: AccountProfilePreferences;
  updatedAt?: string;
}

export interface AccountProfilePreferences {
  schemaVersion: 1;
  defaultView?: AppSettings["defaultView"];
  posterColumns?: number;
  storageMode?: AppSettings["storageMode"];
  accountBackup?: Partial<Pick<AppSettings["accountBackup"], "intervalHours">>;
  supabase?: Partial<Pick<AppSettings["supabase"], "syncMedia">>;
  map?: Partial<AppSettings["map"]>;
}

const profileSelect = "display_name, username, nickname, avatar_url, recovery_email, github_username, github_user_id, linked_supabase_url, linked_supabase_anon_key, linked_supabase_media_bucket, amap_key, preferences, updated_at";
const legacyProfileSelect = "display_name, username, nickname, avatar_url, recovery_email, github_username, github_user_id, linked_supabase_url, linked_supabase_anon_key, linked_supabase_media_bucket, amap_key, updated_at";

export function hasSupabaseConfig(settings: AppSettings) {
  return Boolean(settings.supabase.url && settings.supabase.anonKey);
}

export function hasPersonalCloudConnection(settings: AppSettings) {
  return Boolean(hasSupabaseConfig(settings) && settings.supabase.ownerKey);
}

export function hasAccountCloudConfig(settings?: AppSettings) {
  void settings;
  return Boolean(accountUrl && accountAnonKey);
}

export function makeSupabaseClient(settings: AppSettings) {
  if (!hasSupabaseConfig(settings)) throw new Error("请先填写 Supabase 项目地址和公开连接密钥");
  const headers = settings.supabase.ownerKey ? { [ownerHeader]: settings.supabase.ownerKey } : undefined;
  return createClient(settings.supabase.url, settings.supabase.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: headers ? { headers } : undefined,
  });
}

function makeAccountClient(settings: AppSettings) {
  void settings;
  const url = accountUrl;
  const key = accountAnonKey;
  if (!url || !key) throw new Error("账号服务暂时不可用，请稍后再试");
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: accountUrl ? "live-memory-account-session" : undefined,
    },
  });
}

function currentAppUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  }
  return url.toString();
}

export interface AccountSignInResult {
  message: string;
  isNewAccount: boolean;
}

export async function signInWithPassword(settings: AppSettings, password: string): Promise<AccountSignInResult> {
  const client = makeAccountClient(settings);
  const email = authEmailForSettings(settings);
  const recoveryEmail = validateRecoveryEmail(settings.account.recoveryEmail);
  validatePassword(password);
  const existing = await client.auth.getUser();
  if (existing.data.user) return { message: "账号已登录", isNewAccount: false };
  validateUsername(settings.account.username);

  let { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return { message: "登录成功", isNewAccount: false };
  if (recoveryEmail && recoveryEmail !== email) {
    const legacy = await client.auth.signInWithPassword({ email: recoveryEmail, password });
    if (!legacy.error) return { message: "登录成功", isNewAccount: false };
    error = legacy.error;
  }

  if (isEmailRateLimit(error)) throw new Error("账号请求过于频繁，请稍后再试。");
  throw new Error("用户名或密码不正确。新用户请先选择“创建新账号”。");
}

export async function signUpOnly(settings: AppSettings, password: string): Promise<AccountSignInResult> {
  const client = makeAccountClient(settings);
  const email = authEmailForSettings(settings);
  validatePassword(password);
  const signUp = await client.auth.signUp({
    email,
    password,
    options: { data: accountMetadata(settings) },
  });
  if (signUp.error) {
    if (isEmailRateLimit(signUp.error)) throw new Error("账号邮件请求过于频繁，请稍后再试。");
    if (/already|registered|exists/i.test(signUp.error.message)) throw new Error("该用户名已被注册，请直接登录。");
    throw signUp.error;
  }
  if (!signUp.data.session) {
    if (signUp.data.user?.identities?.length === 0) {
      throw new Error("该用户名已被注册，请直接登录。");
    }
    // Session is null but user exists — likely email confirmation is enabled.
    throw new Error("注册需要关闭邮箱验证：请在 Supabase 控制台的 Authentication → Settings → Email Auth 中关闭 Confirm Email。");
  }
  return { message: "账号已创建", isNewAccount: true };
}

export async function recoverAccountPasswordWithEmail(settings: AppSettings, username: string, recoveryEmail: string, newPassword: string) {
  const client = makeAccountClient(settings);
  const normalizedUsername = validateUsername(username);
  const normalizedRecoveryEmail = validateRecoveryEmail(recoveryEmail);
  validatePassword(newPassword);
  if (!normalizedRecoveryEmail) throw new Error("请输入注册时保存的备用邮箱");
  const { data, error } = await client.rpc("echo_recover_account_password", {
    input_username: normalizedUsername,
    input_recovery_email: normalizedRecoveryEmail,
    input_new_password: newPassword,
  });
  if (error) {
    if (error.code === "42883" || /function.*does not exist|schema cache/i.test(error.message || "")) {
      throw new Error("账号服务需要更新：请在账号 Supabase 项目运行 007_account_recovery_rpc.sql");
    }
    throw error;
  }
  if (data !== true) throw new Error("用户名与备用邮箱不匹配，请检查后重试");
  await client.auth.signOut();
  return "密码已重置，请用新密码登录";
}

export async function signInStorageWithPassword(settings: AppSettings, password: string) {
  if (!hasSupabaseConfig(settings)) throw new Error("请先填写 Supabase 项目地址和公开连接密钥");
  validatePassword(password);
  const ownerKey = await deriveStorageOwnerKey(settings, password);
  return connectStorageWithOwnerKey(settings, ownerKey);
}

export async function signInStorageWithAccount(settings: AppSettings) {
  if (!hasSupabaseConfig(settings)) throw new Error("请先填写 Supabase 项目地址和公开连接密钥");
  const client = makeAccountClient(settings);
  const user = await requireUser(client, "请先登录 Live Memory 账号，再连接个人云端");
  const ownerKey = await deriveStorageOwnerKeyFromSecret(settings, `account:${user.id}`, "account");
  return connectStorageWithOwnerKey(settings, ownerKey);
}

async function connectStorageWithOwnerKey(settings: AppSettings, ownerKey: string) {
  const next = { ...settings, supabase: { ...settings.supabase, ownerKey } };
  const client = makeSupabaseClient(next);
  const probe = await client
    .from("echo_passkey_records")
    .select("id")
    .eq("owner_key", ownerKey)
    .limit(1);
  if (probe.error) throwPersonalCloudError(probe.error);
  return { settings: next, message: "个人云端已连接" };
}

export async function deriveStorageOwnerKey(settings: AppSettings, password: string) {
  return deriveStorageOwnerKeyFromSecret(settings, password);
}

async function deriveStorageOwnerKeyFromSecret(settings: AppSettings, secret: string, identity?: string) {
  const ownerIdentity = identity || validateUsername(settings.account.username);
  const endpoint = settings.supabase.url.trim().replace(/\/+$/, "").toLowerCase();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(`live-memory:v2:${endpoint}:${ownerIdentity}`),
      iterations: 150000,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireOwnerKey(settings: AppSettings) {
  const ownerKey = settings.supabase.ownerKey?.trim();
  if (!ownerKey) throw new Error("请先连接个人云端");
  return ownerKey;
}

function passkeyRecordTable(settings: AppSettings) {
  requireOwnerKey(settings);
  return "echo_passkey_records";
}

function passkeyMediaTable(settings: AppSettings) {
  requireOwnerKey(settings);
  return "echo_passkey_media_assets";
}

function throwPersonalCloudError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const status = (error as { status?: number }).status;
  const message = String((error as { message?: string }).message || "");
  if (code === "42P01" || code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(message)) {
    throw new Error("个人云端需要更新：请在 Supabase 的 SQL Editor 运行 005_passkey_cloud_sync.sql");
  }
  if (code === "42501" || /permission denied/i.test(message)) {
    throw new Error("个人云端访问规则未生效：请重新运行最新的 Supabase 初始化 SQL");
  }
  if (status === 401 || /invalid api key|jwt|apikey/i.test(message)) {
    throw new Error("公开连接密钥不正确：请在 Supabase 的 API 页面复制 anon 或 publishable key");
  }
  if (/failed to fetch|network/i.test(message)) {
    throw new Error("无法连接 Supabase：请检查项目地址是否正确，或稍后重试");
  }
  if (message) throw new Error(`个人云端连接失败：${message}`);
  throw error;
}

export async function updateAccountPassword(settings: AppSettings, password: string) {
  validatePassword(password);
  const client = makeAccountClient(settings);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return "密码已更新";
}

export async function signInWithGithub(settings: AppSettings) {
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

export async function signOut(settings: AppSettings) {
  const client = makeAccountClient(settings);
  await client.auth.signOut();
}

export async function currentUser(settings: AppSettings) {
  const client = makeAccountClient(settings);
  const { data, error } = await client.auth.getUser();
  if (error && isAuthSessionMissing(error)) return null;
  if (error) throw error;
  return data.user || null;
}

// ── Admin dashboard ──────────────────────────────────────────

const ADMIN_USERNAMES = ["qi-i"];

export function isAdmin(settings: AppSettings): boolean {
  return ADMIN_USERNAMES.includes(settings.account.username.toLowerCase());
}

export interface AdminOverview {
  total_users: number;
  total_records: number;
  total_media: number;
  active_users: number;
  latest_users: Array<{ username: string; display_name: string; created_at: string }>;
}

export async function fetchAdminOverview(settings: AppSettings): Promise<AdminOverview> {
  const client = makeAccountClient(settings);
  const { data, error } = await client.rpc("echo_admin_stats_overview");
  if (error) {
    if (error.code === "42883" || /function.*does not exist|schema cache/i.test(error.message || "")) {
      throw new Error("管理面板需要更新：请在账号 Supabase 运行 008_admin_stats.sql");
    }
    throw error;
  }
  return data as AdminOverview;
}

export interface AdminTrendRow {
  day: string;
  new_users: number;
  new_records: number;
}

export async function fetchAdminTrends(settings: AppSettings, days = 30): Promise<AdminTrendRow[]> {
  const client = makeAccountClient(settings);
  const { data, error } = await client.rpc("echo_admin_stats_trends", { p_days: days });
  if (error) {
    if (error.code === "42883" || /function.*does not exist|schema cache/i.test(error.message || "")) {
      throw new Error("管理面板需要更新：请在账号 Supabase 运行 008_admin_stats.sql");
    }
    throw error;
  }
  return (data || []) as AdminTrendRow[];
}

export interface AdminStorageRow {
  username: string;
  display_name: string;
  record_count: number;
  media_count: number;
}

export async function fetchAdminStorageBreakdown(settings: AppSettings): Promise<AdminStorageRow[]> {
  const client = makeAccountClient(settings);
  const { data, error } = await client.rpc("echo_admin_storage_breakdown");
  if (error) {
    if (error.code === "42883" || /function.*does not exist|schema cache/i.test(error.message || "")) {
      throw new Error("管理面板需要更新：请在账号 Supabase 运行 008_admin_stats.sql");
    }
    throw error;
  }
  return (data || []) as AdminStorageRow[];
}

export interface AdminVisitorStats {
  total_views: number;
  unique_paths: number;
  daily_views: Array<{ day: string; count: number }>;
  top_paths: Array<{ path: string; count: number }>;
}

export async function fetchAdminVisitorStats(settings: AppSettings, days = 30): Promise<AdminVisitorStats> {
  const client = makeAccountClient(settings);
  const { data, error } = await client.rpc("echo_admin_visitor_stats", { p_days: days });
  if (error) {
    if (error.code === "42883" || /function.*does not exist|schema cache/i.test(error.message || "")) {
      throw new Error("管理面板需要更新：请在账号 Supabase 运行 008_admin_stats.sql");
    }
    throw error;
  }
  return data as AdminVisitorStats;
}

export async function recordPageView(path: string, referrer?: string): Promise<void> {
  if (!accountUrl || !accountAnonKey) return;
  const client = createClient(accountUrl, accountAnonKey, {
    auth: { persistSession: false },
  });
  await client.rpc("echo_record_page_view", {
    p_path: path,
    p_referrer: referrer || null,
    p_user_agent: navigator.userAgent.slice(0, 500),
  });
}

export async function saveUserProfileBinding(settings: AppSettings): Promise<UserProfileBinding> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client);
  const username = validateUsername(settings.account.username);
  const recoveryEmail = validateRecoveryEmail(settings.account.recoveryEmail);
  const github = githubIdentity(user);
  const displayName = settings.account.nickname || github.displayName || user.email || "";
  const row = {
    user_id: user.id,
    display_name: displayName || null,
    username,
    nickname: settings.account.nickname || null,
    avatar_url: settings.account.avatarUrl || null,
    recovery_email: recoveryEmail || null,
    github_username: github.username || null,
    github_user_id: github.userId || null,
    linked_supabase_url: settings.supabase.url || null,
    linked_supabase_anon_key: settings.supabase.anonKey || null,
    linked_supabase_media_bucket: mediaBucket(settings),
    amap_key: settings.map.amapKey || null,
    preferences: profilePreferencesFromSettings(settings),
    updated_at: nowIso(),
  };

  const { data, error } = await client
    .from("echo_user_profiles")
    .upsert(row, { onConflict: "user_id" })
    .select(profileSelect)
    .single();
  if (error && isMissingPreferencesColumn(error)) {
    const legacyRow = { ...row } as Record<string, unknown>;
    delete legacyRow.preferences;
    const legacy = await client
      .from("echo_user_profiles")
      .upsert(legacyRow, { onConflict: "user_id" })
      .select(legacyProfileSelect)
      .single();
    if (legacy.error) throwProfileError(legacy.error);
    return profileFromRow(legacy.data);
  }
  if (error) throwProfileError(error);
  return profileFromRow(data);
}

export async function loadUserProfileBinding(settings: AppSettings): Promise<UserProfileBinding | null> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client);
  const { data, error } = await client
    .from("echo_user_profiles")
    .select(profileSelect)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error && isMissingPreferencesColumn(error)) {
    const legacy = await client
      .from("echo_user_profiles")
      .select(legacyProfileSelect)
      .eq("user_id", user.id)
      .maybeSingle();
    if (legacy.error) throwProfileError(legacy.error);
    return legacy.data ? profileFromRow(legacy.data) : null;
  }
  if (error) throwProfileError(error);
  return data ? profileFromRow(data) : null;
}

export interface PostLoginSyncResult {
  settings: AppSettings;
  records: EventRecord[];
  message: string;
}

export async function syncAfterLogin(
  settings: AppSettings,
  localRecords: EventRecord[],
): Promise<PostLoginSyncResult> {
  const messages: string[] = [];

  // 1. Profile: pull if exists, push if new
  let nextSettings = settings;
  const profile = await loadUserProfileBinding(settings).catch(() => null);
  if (profile) {
    nextSettings = settingsFromProfileBinding(settings, profile);
    messages.push("资料已恢复");
  } else {
    await saveUserProfileBinding(nextSettings).catch(() => undefined);
    messages.push("资料已上传");
  }

  // 2. Personal Supabase: restore saved project settings, then reconnect using the Live Memory account.
  if (nextSettings.storageMode === "supabase" && hasSupabaseConfig(nextSettings)) {
    try {
      const connected = await signInStorageWithAccount(nextSettings);
      nextSettings = connected.settings;
      messages.push("个人云端已连接");
    } catch {
      messages.push("个人云端配置已恢复");
    }
  }

  // 3. Text records: pull if cloud has data, push if cloud is empty
  let nextRecords = localRecords;
  try {
    const pullResult = await pullTextBackupFromAccount(nextSettings, localRecords);
    const cloudCount = pullResult.records.filter((r) => !r.deletedAt).length;
    if (cloudCount > 0) {
      nextRecords = pullResult.records;
      messages.push(`已恢复 ${cloudCount} 条记录`);
    } else if (localRecords.filter((r) => !r.deletedAt).length > 0) {
      await pushTextBackupToAccount(nextSettings, localRecords);
      messages.push(`已上传 ${localRecords.filter((r) => !r.deletedAt).length} 条记录`);
    }
  } catch {
    messages.push("文字备份暂未恢复");
  }

  return {
    settings: nextSettings,
    records: nextRecords,
    message: messages.join("，") || "同步完成",
  };
}

export async function pushTextBackupToAccount(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client, "请先登录 Live Memory 账号，再使用账号文字备份");
  const rows = records.map((record) => {
    const payload = withoutLocalMedia(record);
    return {
      id: payload.id,
      user_id: user.id,
      payload,
      updated_at: payload.updatedAt,
      deleted_at: payload.deletedAt || null,
    };
  });
  let skipped = 0;
  let uploaded = 0;
  if (rows.length) {
    const existing = await client
      .from("echo_text_backups")
      .select("id, updated_at")
      .eq("user_id", user.id)
      .in("id", rows.map((row) => row.id));
    if (existing.error) throwTextBackupError(existing.error);
    const cloudUpdated = new Map((existing.data || []).map((row) => [String(row.id), String(row.updated_at || "")]));
    const rowsToUpsert = rows.filter((row) => !isCloudNewer(row.updated_at, cloudUpdated.get(row.id)));
    skipped = rows.length - rowsToUpsert.length;
    uploaded = rowsToUpsert.filter((row) => !row.deleted_at).length;
    const { error } = rowsToUpsert.length
      ? await client.from("echo_text_backups").upsert(rowsToUpsert, { onConflict: "user_id,id" })
      : { error: null };
    if (error) throwTextBackupError(error);
  }
  return {
    records,
    message: `已备份 ${uploaded} 条文字记录${skipped ? `，跳过 ${skipped} 条云端较新记录` : ""}`,
  };
}

export async function pullTextBackupFromAccount(settings: AppSettings, localRecords: EventRecord[]): Promise<SyncResult> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client, "请先登录 Live Memory 账号，再恢复账号文字备份");
  const { data, error } = await client
    .from("echo_text_backups")
    .select("payload, updated_at, deleted_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throwTextBackupError(error);
  const cloudRecords = (data || []).map((row) => normalizeRecord({
    ...(row.payload as EventRecord),
    updatedAt: String(row.updated_at || (row.payload as EventRecord).updatedAt),
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
  }));
  const records = mergeTextBackup(localRecords, cloudRecords);
  return { records, message: `已恢复 ${cloudRecords.filter((record) => !record.deletedAt).length} 条文字记录` };
}

export async function purgeTextBackupFromAccount(settings: AppSettings, recordId: string) {
  if (!hasAccountCloudConfig(settings)) return;
  const client = makeAccountClient(settings);
  const user = await requireUser(client, "请先登录 Live Memory 账号，再管理账号文字备份");
  const { error } = await client.from("echo_text_backups").delete().eq("user_id", user.id).eq("id", recordId);
  if (error) throwTextBackupError(error);
}

export async function pushRecordsToSupabase(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  if (!settings.supabase.ownerKey) throw new Error("请先连接个人云端");
  return pushRecordsToPasskeySupabase(settings, records);
}

export async function pullRecordsFromSupabase(settings: AppSettings, localRecords: EventRecord[] = []): Promise<SyncResult> {
  if (!settings.supabase.ownerKey) throw new Error("请先连接个人云端");
  return pullRecordsFromPasskeySupabase(settings, localRecords);
}

export async function refreshSignedMediaUrls(settings: AppSettings, records: EventRecord[]) {
  if (!settings.supabase.ownerKey || !settings.supabase.syncMedia) return records;
  const client = makeSupabaseClient(settings);
  return Promise.all(records.map(async (record) => {
    const media = await Promise.all(record.media.map((asset) => signMediaIfNeeded(client, asset, mediaBucket(settings))));
    return normalizeRecord({ ...record, media });
  }));
}

export async function purgeRecordFromSupabase(settings: AppSettings, recordId: string) {
  if (!settings.supabase.ownerKey) return;
  await purgePasskeyRecordFromSupabase(settings, recordId);
}

// ── Auto-sync ───────────────────────────────────────────────

export interface SyncConflict {
  recordId: string;
  title: string;
  localUpdatedAt: string;
  cloudUpdatedAt: string;
  localRecord: EventRecord;
  cloudRecord: EventRecord;
  source: "account" | "personal";
}

export interface AutoSyncResult {
  records: EventRecord[];
  conflicts: SyncConflict[];
  message: string;
}

export async function autoSyncAll(settings: AppSettings, localRecords: EventRecord[]): Promise<AutoSyncResult> {
  const allConflicts: SyncConflict[] = [];
  const messages: string[] = [];
  let merged = [...localRecords];

  // 1. Account text backup (bidirectional)
  if (hasAccountCloudConfig(settings)) {
    try {
      const accountResult = await syncAccountTextBackup(settings, merged);
      merged = accountResult.records;
      allConflicts.push(...accountResult.conflicts);
      if (accountResult.message) messages.push(accountResult.message);
    } catch {
      // Account sync failure is non-fatal
    }
  }

  // 2. Personal Supabase (bidirectional, if connected)
  if (hasPersonalCloudConnection(settings)) {
    try {
      const personalResult = await syncPersonalSupabase(settings, merged);
      merged = personalResult.records;
      allConflicts.push(...personalResult.conflicts);
      if (personalResult.message) messages.push(personalResult.message);
    } catch {
      // Personal sync failure is non-fatal
    }
  }

  return {
    records: merged,
    conflicts: allConflicts,
    message: messages.join("，") || "自动同步完成",
  };
}

async function syncAccountTextBackup(settings: AppSettings, localRecords: EventRecord[]): Promise<AutoSyncResult> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client);
  const conflicts: SyncConflict[] = [];

  // Pull all cloud records
  const { data, error } = await client
    .from("echo_text_backups")
    .select("payload, updated_at, deleted_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throwTextBackupError(error);

  const cloudRecords = (data || []).map((row) => normalizeRecord({
    ...(row.payload as EventRecord),
    updatedAt: String(row.updated_at || (row.payload as EventRecord).updatedAt),
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
  }));

  const localById = new Map(localRecords.map((r) => [r.id, r]));
  const cloudById = new Map(cloudRecords.map((r) => [r.id, r]));
  const merged = new Map(localById);
  const toPush: EventRecord[] = [];

  // Check each local record against cloud
  for (const [id, local] of localById) {
    const cloud = cloudById.get(id);
    if (!cloud) {
      // Only in local → push
      toPush.push(local);
      continue;
    }
    // Exists in both → check for conflicts
    const syncedAt = local.syncedAt;
    if (syncedAt) {
      const localChanged = local.updatedAt > syncedAt;
      const cloudChanged = cloud.updatedAt > syncedAt;
      if (localChanged && cloudChanged) {
        conflicts.push({
          recordId: id,
          title: local.title,
          localUpdatedAt: local.updatedAt,
          cloudUpdatedAt: cloud.updatedAt,
          localRecord: local,
          cloudRecord: cloud,
          source: "account",
        });
      } else if (!localChanged && cloudChanged) {
        // Cloud wins
        merged.set(id, normalizeRecord({ ...cloud, media: local.media, syncedAt: nowIso() }));
      } else if (localChanged && !cloudChanged) {
        toPush.push(local);
      }
      // Neither changed → skip
    } else {
      // No syncedAt → last-write-wins
      if (cloud.updatedAt > local.updatedAt) {
        merged.set(id, normalizeRecord({ ...cloud, media: local.media, syncedAt: nowIso() }));
      } else {
        toPush.push(local);
      }
    }
  }

  // Cloud-only records → pull
  for (const [id, cloud] of cloudById) {
    if (!localById.has(id)) {
      merged.set(id, normalizeRecord({ ...cloud, media: [], syncedAt: nowIso() }));
    }
  }

  // Push local changes
  if (toPush.length) {
    const rows = toPush.map((record) => ({
      id: record.id,
      user_id: user.id,
      payload: withoutLocalMedia({ ...record, syncedAt: nowIso() }),
      updated_at: record.updatedAt,
      deleted_at: record.deletedAt || null,
    }));
    const { error: pushError } = await client.from("echo_text_backups").upsert(rows, { onConflict: "user_id,id" });
    if (pushError) throwTextBackupError(pushError);
    // Update local syncedAt for pushed records
    for (const record of toPush) {
      const existing = merged.get(record.id);
      if (existing) merged.set(record.id, { ...existing, syncedAt: nowIso() });
    }
  }

  const records = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
  return {
    records,
    conflicts,
    message: toPush.length ? `已同步 ${toPush.length} 条记录到账号备份` : "",
  };
}

async function syncPersonalSupabase(settings: AppSettings, localRecords: EventRecord[]): Promise<AutoSyncResult> {
  const ownerKey = requireOwnerKey(settings);
  const client = makeSupabaseClient(settings);
  const conflicts: SyncConflict[] = [];

  // Pull all cloud records
  const { data, error } = await client
    .from("echo_passkey_records")
    .select("payload, updated_at, deleted_at")
    .eq("owner_key", ownerKey)
    .order("updated_at", { ascending: false });
  if (error) throwPersonalCloudError(error);

  const cloudRecords = (data || []).map((row) => normalizeRecord({
    ...(row.payload as EventRecord),
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
  }));

  const localById = new Map(localRecords.map((r) => [r.id, r]));
  const cloudById = new Map(cloudRecords.map((r) => [r.id, r]));
  const merged = new Map(localById);
  const toPush: EventRecord[] = [];

  for (const [id, local] of localById) {
    const cloud = cloudById.get(id);
    if (!cloud) {
      toPush.push(local);
      continue;
    }
    const syncedAt = local.syncedAt;
    if (syncedAt) {
      const localChanged = local.updatedAt > syncedAt;
      const cloudChanged = cloud.updatedAt > syncedAt;
      if (localChanged && cloudChanged) {
        conflicts.push({
          recordId: id,
          title: local.title,
          localUpdatedAt: local.updatedAt,
          cloudUpdatedAt: cloud.updatedAt,
          localRecord: local,
          cloudRecord: cloud,
          source: "personal",
        });
      } else if (!localChanged && cloudChanged) {
        merged.set(id, normalizeRecord({ ...cloud, syncedAt: nowIso() }));
      } else if (localChanged && !cloudChanged) {
        toPush.push(local);
      }
    } else {
      if (cloud.updatedAt > local.updatedAt) {
        merged.set(id, normalizeRecord({ ...cloud, syncedAt: nowIso() }));
      } else {
        toPush.push(local);
      }
    }
  }

  for (const [id, cloud] of cloudById) {
    if (!localById.has(id)) {
      merged.set(id, normalizeRecord({ ...cloud, syncedAt: nowIso() }));
    }
  }

  // Push local changes
  if (toPush.length) {
    for (const record of toPush) {
      const syncedRecord = { ...record, syncedAt: nowIso() };
      const cloudPayload = settings.supabase.syncMedia ? cloudRecordPayload(syncedRecord) : withoutLocalMedia(syncedRecord);
      const { error: pushError } = await client.from("echo_passkey_records").upsert(
        {
          id: syncedRecord.id,
          owner_key: ownerKey,
          payload: cloudPayload,
          updated_at: syncedRecord.updatedAt,
          deleted_at: syncedRecord.deletedAt || null,
        },
        { onConflict: "owner_key,id" },
      );
      if (pushError) throwPersonalCloudError(pushError);
      merged.set(record.id, syncedRecord);

      // Upload media if syncMedia is enabled
      if (settings.supabase.syncMedia && !record.deletedAt) {
        const bucket = mediaBucket(settings);
        for (const asset of record.media) {
          if (!asset.storagePath && asset.src.startsWith("data:")) {
            try {
              await uploadMediaIfNeeded(client, ownerKey, record.id, asset, bucket);
            } catch {
              // Individual media upload failure is non-fatal
            }
          }
        }
      }
    }
  }

  const records = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
  return {
    records,
    conflicts,
    message: toPush.length ? `已同步 ${toPush.length} 条记录到个人云端` : "",
  };
}

export async function resolveSyncConflict(
  settings: AppSettings,
  conflict: SyncConflict,
  choice: "local" | "cloud",
): Promise<EventRecord> {
  const resolved = choice === "local"
    ? { ...conflict.localRecord, syncedAt: nowIso() }
    : { ...conflict.cloudRecord, syncedAt: nowIso(), media: choice === "cloud" ? conflict.localRecord.media : conflict.cloudRecord.media };

  if (choice === "local") {
    // Push local version to cloud
    if (conflict.source === "account") {
      const client = makeAccountClient(settings);
      const user = await requireUser(client);
      await client.from("echo_text_backups").upsert({
        id: resolved.id,
        user_id: user.id,
        payload: withoutLocalMedia(resolved),
        updated_at: resolved.updatedAt,
        deleted_at: resolved.deletedAt || null,
      }, { onConflict: "user_id,id" });
    } else {
      const ownerKey = requireOwnerKey(settings);
      const client = makeSupabaseClient(settings);
      const cloudPayload = settings.supabase.syncMedia ? cloudRecordPayload(resolved) : withoutLocalMedia(resolved);
      await client.from("echo_passkey_records").upsert({
        id: resolved.id,
        owner_key: ownerKey,
        payload: cloudPayload,
        updated_at: resolved.updatedAt,
        deleted_at: resolved.deletedAt || null,
      }, { onConflict: "owner_key,id" });
    }
  }

  return normalizeRecord(resolved);
}

export async function resolveAllConflicts(
  settings: AppSettings,
  conflicts: SyncConflict[],
  choice: "local" | "cloud",
): Promise<EventRecord[]> {
  const resolved: EventRecord[] = [];
  for (const conflict of conflicts) {
    const record = await resolveSyncConflict(settings, conflict, choice);
    resolved.push(record);
  }
  return resolved;
}

async function pushRecordsToPasskeySupabase(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  const ownerKey = requireOwnerKey(settings);
  const client = makeSupabaseClient(settings);
  const resultRecords: EventRecord[] = [];
  let skipped = 0;
  let uploaded = 0;
  const ids = records.map((record) => record.id);
  const existing = ids.length
    ? await client
      .from(passkeyRecordTable(settings))
      .select("id, updated_at")
      .eq("owner_key", ownerKey)
      .in("id", ids)
    : { data: [], error: null };
  if (existing.error) throwPersonalCloudError(existing.error);
  const cloudUpdated = new Map((existing.data || []).map((row) => [String(row.id), String(row.updated_at || "")]));

  for (const record of records) {
    if (isCloudNewer(record.updatedAt, cloudUpdated.get(record.id))) {
      skipped += 1;
      resultRecords.push(normalizeRecord(record));
      continue;
    }
    const bucket = mediaBucket(settings);
    const media = record.deletedAt || !settings.supabase.syncMedia
      ? record.media
      : await Promise.all(record.media.map((asset) => uploadMediaIfNeeded(client, ownerKey, record.id, asset, bucket)));
    const next = normalizeRecord({ ...record, media, updatedAt: nowIso() });
    if (!next.deletedAt) uploaded += 1;
    const cloudPayload = next.deletedAt
      ? cloudRecordPayload({ ...next, media: next.media.filter((asset) => asset.storagePath) })
      : settings.supabase.syncMedia ? cloudRecordPayload(next) : withoutLocalMedia(next);
    resultRecords.push(next);
    const { error } = await client.from(passkeyRecordTable(settings)).upsert(
      {
        id: next.id,
        owner_key: ownerKey,
        payload: cloudPayload,
        updated_at: next.updatedAt,
        deleted_at: next.deletedAt || null,
      },
      { onConflict: "owner_key,id" },
    );
    if (error) throwPersonalCloudError(error);

    const mediaRows = settings.supabase.syncMedia && !record.deletedAt ? media.map((asset) => ({
      id: asset.id,
      owner_key: ownerKey,
      record_id: record.id,
      kind: asset.kind,
      storage_path: asset.storagePath || null,
      external_url: asset.storagePath ? null : asset.src,
      metadata: {
        title: asset.title,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        size: asset.size,
        source: asset.source,
      },
      updated_at: asset.updatedAt,
      deleted_at: null,
    })) : [];
    if (mediaRows.length) {
      const mediaUpsert = await client.from(passkeyMediaTable(settings)).upsert(mediaRows, { onConflict: "owner_key,id" });
      if (mediaUpsert.error) throwPersonalCloudError(mediaUpsert.error);
    }
  }

  return {
    records: resultRecords,
    message: settings.supabase.syncMedia
      ? `已同步 ${uploaded} 条记录和图片${skipped ? `，跳过 ${skipped} 条云端较新记录` : ""}`
      : `已同步 ${uploaded} 条文字记录${skipped ? `，跳过 ${skipped} 条云端较新记录` : ""}`,
  };
}

async function pullRecordsFromPasskeySupabase(settings: AppSettings, localRecords: EventRecord[] = []): Promise<SyncResult> {
  const ownerKey = requireOwnerKey(settings);
  const client = makeSupabaseClient(settings);
  const { data, error } = await client
    .from(passkeyRecordTable(settings))
    .select("payload, updated_at, deleted_at")
    .eq("owner_key", ownerKey)
    .order("updated_at", { ascending: false });
  if (error) throwPersonalCloudError(error);

  const records = await Promise.all(
    (data || []).map(async (row) => {
      const record = normalizeRecord({
        ...(row.payload as EventRecord),
        deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
      });
      if (!settings.supabase.syncMedia) return withoutLocalMedia(record);
      const media = await Promise.all(record.media.map((asset) => signMediaIfNeeded(client, asset, mediaBucket(settings))));
      return normalizeRecord({ ...record, media });
    }),
  );
  const merged = settings.supabase.syncMedia ? records : mergeTextBackup(localRecords, records);
  return { records: merged, message: `已恢复 ${records.filter((record) => !record.deletedAt).length} 条记录` };
}

async function purgePasskeyRecordFromSupabase(settings: AppSettings, recordId: string) {
  const ownerKey = requireOwnerKey(settings);
  const client = makeSupabaseClient(settings);
  const listed = await client.storage.from(mediaBucket(settings)).list(`${ownerKey}/${recordId}`);
  if (!listed.error && listed.data?.length) {
    await client.storage.from(mediaBucket(settings)).remove(listed.data.map((item) => `${ownerKey}/${recordId}/${item.name}`));
  }
  const { error } = await client.from(passkeyRecordTable(settings)).delete().eq("owner_key", ownerKey).eq("id", recordId);
  if (error) throwPersonalCloudError(error);
}

async function requireUser(client: SupabaseClient, message = "请先登录账号") {
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (isAuthSessionMissing(error)) throw new Error(message);
    throw error;
  }
  if (!data.user) throw new Error(message);
  return data.user;
}

export function friendlySupabaseErrorMessage(error: unknown, fallback = "未完成，请检查页面设置") {
  if (isAuthSessionMissing(error)) return "请先登录 Live Memory 账号，或关闭账号文字备份后再试";
  if (isEmailRateLimit(error)) return "账号邮件请求过于频繁，请稍后再试。连接个人 Supabase 不需要账号邮件。";
  const message = String((error as { message?: string }).message || "");
  if (message) return message;
  const details = String((error as { details?: string }).details || "");
  if (details) return details;
  const code = String((error as { code?: string }).code || "");
  if (code) return `${fallback}：${code}`;
  return fallback;
}

function isAuthSessionMissing(error: unknown) {
  const name = String((error as { name?: string }).name || "");
  const message = String((error as { message?: string }).message || "");
  return /AuthSessionMissing|Auth session missing|session missing/i.test(`${name} ${message}`);
}

function isEmailRateLimit(error: unknown) {
  const message = String((error as { message?: string }).message || "");
  return /email rate limit|rate limit exceeded|too many/i.test(message);
}

function isCloudNewer(localUpdatedAt: string, cloudUpdatedAt?: string) {
  return Boolean(cloudUpdatedAt && cloudUpdatedAt > localUpdatedAt);
}

function githubIdentity(user: Awaited<ReturnType<typeof requireUser>>) {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const identities = (user as { identities?: Array<{ provider?: string; id?: string; identity_data?: Record<string, unknown> }> }).identities || [];
  const github = identities.find((identity) => identity.provider === "github");
  const identityData = github?.identity_data;
  return {
    displayName: pickString(metadata?.nickname, metadata?.name, metadata?.full_name, identityData?.name, identityData?.full_name, metadata?.user_name, identityData?.user_name),
    username: pickString(metadata?.user_name, metadata?.preferred_username, identityData?.user_name, identityData?.preferred_username),
    userId: pickString(metadata?.provider_id, identityData?.provider_id, github?.id),
  };
}

function profileFromRow(row: Record<string, unknown>): UserProfileBinding {
  return {
    displayName: pickString(row.display_name),
    username: pickString(row.username),
    nickname: pickString(row.nickname),
    avatarUrl: pickString(row.avatar_url),
    recoveryEmail: pickString(row.recovery_email),
    githubUsername: pickString(row.github_username),
    githubUserId: pickString(row.github_user_id),
    supabaseUrl: pickString(row.linked_supabase_url),
    supabaseAnonKey: pickString(row.linked_supabase_anon_key),
    mediaBucket: pickString(row.linked_supabase_media_bucket) || "echo-media",
    amapKey: pickString(row.amap_key),
    preferences: normalizeProfilePreferences(row.preferences),
    updatedAt: pickString(row.updated_at),
  };
}

function settingsFromProfileBinding(settings: AppSettings, profile: UserProfileBinding): AppSettings {
  const preferences = profile.preferences;
  const accountBackup = preferences.accountBackup || {};
  const supabasePreferences = preferences.supabase || {};
  const mapPreferences = preferences.map || {};
  const hasLinkedSupabase = Boolean(profile.supabaseUrl && profile.supabaseAnonKey);
  return {
    ...settings,
    defaultView: preferences.defaultView || settings.defaultView,
    posterColumns: Math.min(6, Math.max(2, Number(preferences.posterColumns || settings.posterColumns || 4))),
    storageMode: preferences.storageMode || (hasLinkedSupabase ? "supabase" : settings.storageMode),
    account: {
      ...settings.account,
      username: profile.username || settings.account.username,
      nickname: profile.nickname || profile.displayName || settings.account.nickname,
      avatarUrl: profile.avatarUrl || settings.account.avatarUrl,
      recoveryEmail: profile.recoveryEmail || settings.account.recoveryEmail,
    },
    accountBackup: {
      ...settings.accountBackup,
      ...(Number.isFinite(Number(accountBackup.intervalHours)) ? { intervalHours: Math.max(1, Number(accountBackup.intervalHours)) } : {}),
    },
    supabase: {
      ...settings.supabase,
      url: profile.supabaseUrl || settings.supabase.url,
      anonKey: profile.supabaseAnonKey || settings.supabase.anonKey,
      mediaBucket: profile.mediaBucket || settings.supabase.mediaBucket,
      syncMedia: typeof supabasePreferences.syncMedia === "boolean" ? supabasePreferences.syncMedia : settings.supabase.syncMedia,
      ownerKey: "",
    },
    map: {
      ...settings.map,
      provider: mapPreferences.provider || (profile.amapKey ? "amap" : settings.map.provider),
      amapKey: mapPreferences.amapKey || profile.amapKey || settings.map.amapKey,
      amapSecurityCode: mapPreferences.amapSecurityCode || settings.map.amapSecurityCode,
      baiduAk: mapPreferences.baiduAk || settings.map.baiduAk,
    },
  };
}

function profilePreferencesFromSettings(settings: AppSettings): AccountProfilePreferences {
  return {
    schemaVersion: 1,
    defaultView: settings.defaultView,
    posterColumns: Math.min(6, Math.max(2, Number(settings.posterColumns || 4))),
    storageMode: settings.storageMode,
    accountBackup: {
      intervalHours: Math.max(1, Number(settings.accountBackup.intervalHours || 24)),
    },
    supabase: {
      syncMedia: settings.supabase.syncMedia,
    },
    map: {
      provider: settings.map.provider,
      amapKey: settings.map.amapKey,
      amapSecurityCode: settings.map.amapSecurityCode,
      baiduAk: settings.map.baiduAk,
    },
  };
}

function normalizeProfilePreferences(value: unknown): AccountProfilePreferences {
  const raw = isRecord(value) ? value : {};
  const accountBackup = isRecord(raw.accountBackup) ? raw.accountBackup : {};
  const supabase = isRecord(raw.supabase) ? raw.supabase : {};
  const map = isRecord(raw.map) ? raw.map : {};
  const defaultView = pickArchiveView(raw.defaultView);
  const posterColumns = Number(raw.posterColumns);
  const storageMode = raw.storageMode === "local" || raw.storageMode === "supabase" ? raw.storageMode : undefined;
  const mapProvider = map.provider === "amap" || map.provider === "baidu" || map.provider === "none" ? map.provider : undefined;
  return {
    schemaVersion: 1,
    ...(defaultView ? { defaultView } : {}),
    ...(Number.isFinite(posterColumns) ? { posterColumns: Math.min(6, Math.max(2, posterColumns)) } : {}),
    ...(storageMode ? { storageMode } : {}),
    accountBackup: {
      ...(Number.isFinite(Number(accountBackup.intervalHours)) ? { intervalHours: Math.max(1, Number(accountBackup.intervalHours)) } : {}),
    },
    supabase: {
      ...(typeof supabase.syncMedia === "boolean" ? { syncMedia: supabase.syncMedia } : {}),
    },
    map: {
      ...(mapProvider ? { provider: mapProvider } : {}),
      amapKey: pickString(map.amapKey),
      amapSecurityCode: pickString(map.amapSecurityCode),
      baiduAk: pickString(map.baiduAk),
    },
  };
}

function accountMetadata(settings: AppSettings) {
  const account = settings.account;
  return {
    username: validateUsername(account.username),
    nickname: account.nickname.trim(),
    name: account.nickname.trim() || validateUsername(account.username),
  };
}

function authEmailForSettings(settings: AppSettings) {
  const username = validateUsername(settings.account.username);
  return `${username}@users.live-memory.local`;
}

function pickString(...values: unknown[]) {
  const value = values.find((item): item is string => typeof item === "string" && item.trim().length > 0);
  return value?.trim() || "";
}

function pickArchiveView(value: unknown): AppSettings["defaultView"] | undefined {
  const view = String(value || "");
  return view === "poster" || view === "wallet" || view === "ticket" || view === "timeline" || view === "price" || view === "summary" || view === "calendar" || view === "venue" || view === "list"
    ? view
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingPreferencesColumn(error: unknown) {
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message || "");
  return code === "42703" || /preferences.*does not exist|column.*preferences/i.test(message);
}

function throwProfileError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === "23505") throw new Error("这个用户名已被使用，请换一个用户名");
  if (code === "42P01") throw new Error("账号资料暂不可用，请稍后再试");
  if (code === "42703") throw new Error("账号资料需要更新，请稍后再试");
  throw error;
}

function throwTextBackupError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (isAuthSessionMissing(error)) throw new Error("请先登录 Live Memory 账号，再使用账号文字备份");
  if (code === "42P01") throw new Error("文字备份暂不可用，请稍后再试");
  throw error;
}

async function uploadMediaIfNeeded(client: SupabaseClient, userId: string, recordId: string, asset: MediaAsset, bucket: string): Promise<MediaAsset> {
  if (asset.storagePath || !asset.src.startsWith("data:")) return asset;
  const blob = dataUrlToBlob(asset.src);
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/${recordId}/${asset.id}.${extension}`;
  const upload = await client.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: blob.type || asset.mimeType || "image/jpeg",
  });
  if (upload.error) throw upload.error;
  return {
    ...asset,
    storagePath: path,
    updatedAt: nowIso(),
  };
}

async function signMediaIfNeeded(client: SupabaseClient, asset: MediaAsset, bucket: string): Promise<MediaAsset> {
  if (asset.src.startsWith("data:")) return asset;
  if (!asset.storagePath) return asset;
  const signed = await client.storage.from(bucket).createSignedUrl(asset.storagePath, 60 * 60 * 24 * 7);
  if (signed.error || !signed.data?.signedUrl) return asset;
  return { ...asset, src: signed.data.signedUrl, source: "supabase" };
}

function cloudRecordPayload(record: EventRecord) {
  return normalizeRecord({
    ...record,
    media: record.media.map((asset) => asset.storagePath
      ? { ...asset, src: "", source: "supabase" as const }
      : asset),
  });
}
