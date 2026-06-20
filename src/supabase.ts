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
  updatedAt?: string;
}

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
  validatePassword(password);
  const existing = await client.auth.getUser();
  if (existing.data.user) return { message: "账号已登录", isNewAccount: false };

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return { message: "登录成功", isNewAccount: false };

  // Login failed — only attempt sign-up when the error looks like "no such account".
  // If the account exists but the password is wrong, tell the user directly.
  const loginMessage = (error.message || "").toLowerCase();
  const isNotFound = /not found|not exist|unknown user|no user|user not/i.test(loginMessage);

  if (!isNotFound) {
    if (isEmailRateLimit(error)) {
      throw new Error("账号邮件请求过于频繁，请稍后再试。个人 Supabase 连接不需要账号邮件。");
    }
    throw new Error("密码不正确，请检查后重试");
  }

  const signUp = await client.auth.signUp({
    email,
    password,
    options: {
      data: accountMetadata(settings),
    },
  });
  if (signUp.error) {
    if (isEmailRateLimit(signUp.error)) throw new Error("账号邮件请求过于频繁，请稍后再试。个人 Supabase 连接不需要账号邮件。");
    if (/already|registered|exists/i.test(signUp.error.message)) throw new Error("密码不正确，请检查后重试");
    if (/invalid login/i.test(signUp.error.message)) throw new Error("用户名、邮箱或密码不正确");
    throw signUp.error;
  }
  if (!signUp.data.session && signUp.data.user?.identities?.length === 0) throw new Error("用户名、邮箱或密码不正确");
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
  if (!signUp.data.session && signUp.data.user?.identities?.length === 0) {
    throw new Error("该用户名已被注册，请直接登录。");
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
  const email = validateRecoveryEmail(settings.account.recoveryEmail);
  if (!email) throw new Error("请先填写找回邮箱");
  const client = makeAccountClient(settings);
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: currentAppUrl() });
  if (error) throw error;
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
  if (recoveryEmail && user.email !== recoveryEmail) {
    const updated = await client.auth.updateUser({ email: recoveryEmail });
    if (updated.error) throw updated.error;
  }
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
    updated_at: nowIso(),
  };

  const { data, error } = await client
    .from("echo_user_profiles")
    .upsert(row, { onConflict: "user_id" })
    .select("display_name, username, nickname, avatar_url, recovery_email, github_username, github_user_id, linked_supabase_url, linked_supabase_anon_key, linked_supabase_media_bucket, amap_key, updated_at")
    .single();
  if (error) throwProfileError(error);
  return profileFromRow(data);
}

export async function loadUserProfileBinding(settings: AppSettings): Promise<UserProfileBinding | null> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client);
  const { data, error } = await client
    .from("echo_user_profiles")
    .select("display_name, username, nickname, avatar_url, recovery_email, github_username, github_user_id, linked_supabase_url, linked_supabase_anon_key, linked_supabase_media_bucket, amap_key, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
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
    nextSettings = {
      ...settings,
      account: {
        ...settings.account,
        username: profile.username || settings.account.username,
        nickname: profile.nickname || profile.displayName || settings.account.nickname,
        avatarUrl: profile.avatarUrl || settings.account.avatarUrl,
        recoveryEmail: profile.recoveryEmail || settings.account.recoveryEmail,
      },
      supabase: {
        ...settings.supabase,
        url: profile.supabaseUrl || settings.supabase.url,
        anonKey: profile.supabaseAnonKey || settings.supabase.anonKey,
        mediaBucket: profile.mediaBucket || settings.supabase.mediaBucket,
        ownerKey: "",
      },
      map: { ...settings.map, amapKey: profile.amapKey || settings.map.amapKey },
    };
    messages.push("资料已恢复");
  } else {
    await saveUserProfileBinding(nextSettings).catch(() => undefined);
    messages.push("资料已上传");
  }

  // 2. Text records: pull if cloud has data, push if cloud is empty
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
    updatedAt: pickString(row.updated_at),
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
  const recoveryEmail = validateRecoveryEmail(settings.account.recoveryEmail);
  if (recoveryEmail) return recoveryEmail;
  const username = validateUsername(settings.account.username);
  return `${username}@users.live-memory.local`;
}

function pickString(...values: unknown[]) {
  const value = values.find((item): item is string => typeof item === "string" && item.trim().length > 0);
  return value?.trim() || "";
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
