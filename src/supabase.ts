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

  const username = validateUsername(settings.account.username);

  // Pre-check: does this username have a profile record?
  const { data: profile } = await client
    .from("echo_user_profiles")
    .select("username")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  const profileExists = Boolean(profile);

  let { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return { message: "登录成功", isNewAccount: false };
  if (recoveryEmail && recoveryEmail !== email) {
    const legacy = await client.auth.signInWithPassword({ email: recoveryEmail, password });
    if (!legacy.error) return { message: "登录成功", isNewAccount: false };
    error = legacy.error;
  }

  // Login failed — decide what to do based on profile existence and error message.
  const loginMessage = (error.message || "").toLowerCase();
  const isNotFound = /not found|not exist|unknown user|no user|user not/i.test(loginMessage);

  if (profileExists) {
    // Account exists in our records — must be a wrong password.
    throw new Error("密码错误，请检查后重试");
  }

  if (!isNotFound) {
    // Generic error (e.g. "Invalid login credentials") and no profile found.
    // The account likely doesn't exist in Supabase Auth — auto-register.
    return autoRegister(client, email, password, settings);
  }

  // Explicit "not found" from Supabase — auto-register.
  return autoRegister(client, email, password, settings);
}

async function autoRegister(
  client: SupabaseClient,
  email: string,
  password: string,
  settings: AppSettings,
): Promise<AccountSignInResult> {
  const signUp = await client.auth.signUp({
    email,
    password,
    options: { data: accountMetadata(settings) },
  });
  if (signUp.error) {
    if (isEmailRateLimit(signUp.error)) throw new Error("账号服务暂时不可用，请稍后再试。");
    if (/already|registered|exists/i.test(signUp.error.message)) throw new Error("密码错误，请检查后重试");
    throw signUp.error;
  }
  if (!signUp.data.session) {
    if (signUp.data.user?.identities?.length === 0) throw new Error("密码错误，请检查后重试");
    throw new Error("注册需要关闭邮箱验证：请在 Supabase 控制台的 Authentication → Settings → Email Auth 中关闭 Confirm Email。");
  }
  return { message: "账号已创建", isNewAccount: true };
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

export async function requestPasswordReset(settings: AppSettings) {
  const recoveryEmail = validateRecoveryEmail(settings.account.recoveryEmail);
  if (!recoveryEmail) throw new Error("请先填写备用邮箱");
  const username = validateUsername(settings.account.username);
  const client = makeAccountClient(settings);

  // Use the RPC to find the auth email (synthetic) that matches this username.
  const { data: authEmail, error: rpcError } = await client
    .rpc("echo_find_auth_email", { p_username: username });
  if (rpcError) {
    if (/no_recovery_email/i.test(rpcError.message)) throw new Error("该账号未设置备用邮箱。");
    throw rpcError;
  }
  if (!authEmail) throw new Error("账号服务暂时不可用，请稍后再试。");

  const { error } = await client.auth.resetPasswordForEmail(String(authEmail), { redirectTo: currentAppUrl() });
  if (error) {
    if (isEmailRateLimit(error)) throw new Error("邮件请求过于频繁，请稍后再试。");
    throw error;
  }
  return "找回邮件已发送";
}

export async function requestPasswordResetByUsername(username: string) {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) throw new Error("请输入用户名");
  if (!accountUrl || !accountAnonKey) throw new Error("账号服务暂时不可用，请稍后再试");
  const client = createClient(accountUrl, accountAnonKey, {
    auth: { persistSession: false },
  });

  // Use the RPC to find the auth email for this username.
  // The RPC verifies the profile has a recovery email and returns the auth email from auth.users.
  const { data: authEmail, error: rpcError } = await client
    .rpc("echo_find_auth_email", { p_username: trimmed });
  if (rpcError) {
    if (/no_recovery_email/i.test(rpcError.message)) {
      throw new Error("该账号未设置备用邮箱，无法通过邮件重置密码。");
    }
    if (/user_not_found/i.test(rpcError.message)) {
      throw new Error("该用户名不存在。");
    }
    throw rpcError;
  }
  if (!authEmail) throw new Error("账号服务暂时不可用，请稍后再试。");

  const { error } = await client.auth.resetPasswordForEmail(String(authEmail), { redirectTo: currentAppUrl() });
  if (error) {
    if (isEmailRateLimit(error)) throw new Error("邮件请求过于频繁，请稍后再试。");
    throw error;
  }
  return "找回邮件已发送";
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
    // Text backup tables may not exist yet; push local data as fallback
    if (localRecords.filter((r) => !r.deletedAt).length > 0) {
      await pushTextBackupToAccount(nextSettings, localRecords).catch(() => undefined);
    }
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
  if (rows.length) {
    const { error } = await client.from("echo_text_backups").upsert(rows, { onConflict: "user_id,id" });
    if (error) throwTextBackupError(error);
  }
  return { records, message: `已备份 ${rows.filter((row) => !row.deleted_at).length} 条文字记录` };
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

async function pushRecordsToPasskeySupabase(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  const ownerKey = requireOwnerKey(settings);
  const client = makeSupabaseClient(settings);
  const uploadedRecords: EventRecord[] = [];

  for (const record of records) {
    const bucket = mediaBucket(settings);
    const media = record.deletedAt || !settings.supabase.syncMedia
      ? record.media
      : await Promise.all(record.media.map((asset) => uploadMediaIfNeeded(client, ownerKey, record.id, asset, bucket)));
    const next = normalizeRecord({ ...record, media, updatedAt: nowIso() });
    const cloudPayload = next.deletedAt
      ? cloudRecordPayload({ ...next, media: next.media.filter((asset) => asset.storagePath) })
      : settings.supabase.syncMedia ? cloudRecordPayload(next) : withoutLocalMedia(next);
    uploadedRecords.push(next);
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
    records: uploadedRecords,
    message: settings.supabase.syncMedia
      ? `已同步 ${uploadedRecords.filter((record) => !record.deletedAt).length} 条记录和图片`
      : `已同步 ${uploadedRecords.filter((record) => !record.deletedAt).length} 条文字记录`,
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
