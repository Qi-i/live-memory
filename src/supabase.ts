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

export function hasAccountCloudConfig(settings?: AppSettings) {
  void settings;
  return Boolean(accountUrl && accountAnonKey);
}

export function makeSupabaseClient(settings: AppSettings) {
  if (!hasSupabaseConfig(settings)) throw new Error("请先填写 Supabase 项目地址和公开连接密钥");
  return createClient(settings.supabase.url, settings.supabase.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
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

export async function signInWithPassword(settings: AppSettings, password: string) {
  const client = makeAccountClient(settings);
  const email = authEmailForSettings(settings);
  validatePassword(password);
  const existing = await client.auth.getUser();
  if (existing.data.user) return "账号已登录";
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return "登录成功";

  const signUp = await client.auth.signUp({
    email,
    password,
    options: {
      data: accountMetadata(settings),
    },
  });
  if (signUp.error) {
    if (/already|registered|exists|invalid login/i.test(signUp.error.message)) throw new Error("用户名、邮箱或密码不正确");
    throw signUp.error;
  }
  if (!signUp.data.session && signUp.data.user?.identities?.length === 0) throw new Error("用户名、邮箱或密码不正确");
  return "账号已创建";
}

export async function signInStorageWithPassword(settings: AppSettings, password: string) {
  const client = makeSupabaseClient(settings);
  const email = storageEmailForSettings(settings);
  validatePassword(password);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return "个人云端已连接";
  const signUp = await client.auth.signUp({ email, password, options: { data: accountMetadata(settings) } });
  if (signUp.error) {
    if (/already|registered|exists|invalid login/i.test(signUp.error.message)) throw new Error("个人云端密码不正确");
    throw signUp.error;
  }
  if (!signUp.data.session && signUp.data.user?.identities?.length === 0) throw new Error("个人云端密码不正确");
  return "个人云端账号已创建";
}

export async function requestPasswordReset(settings: AppSettings) {
  const email = validateRecoveryEmail(settings.account.recoveryEmail);
  if (!email) throw new Error("请先填写账号邮箱");
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
  const { data } = await client.auth.getUser();
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

export async function pushTextBackupToAccount(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  const client = makeAccountClient(settings);
  const user = await requireUser(client, "请先登录 Live Memory 账号");
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
  const user = await requireUser(client, "请先登录 Live Memory 账号");
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
  const user = await requireUser(client, "请先登录 Live Memory 账号");
  const { error } = await client.from("echo_text_backups").delete().eq("user_id", user.id).eq("id", recordId);
  if (error) throwTextBackupError(error);
}

export async function pushRecordsToSupabase(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  const client = makeSupabaseClient(settings);
  const user = await requireUser(client, "请先连接个人 Supabase");
  const uploadedRecords: EventRecord[] = [];

  for (const record of records) {
    const bucket = mediaBucket(settings);
    const media = record.deletedAt || !settings.supabase.syncMedia
      ? record.media
      : await Promise.all(record.media.map((asset) => uploadMediaIfNeeded(client, user.id, record.id, asset, bucket)));
    const next = normalizeRecord({ ...record, media, updatedAt: nowIso() });
    const cloudPayload = next.deletedAt
      ? normalizeRecord({ ...next, media: next.media.filter((asset) => asset.storagePath) })
      : settings.supabase.syncMedia ? next : withoutLocalMedia(next);
    uploadedRecords.push(next);
    const { error } = await client.from("echo_records").upsert(
      {
        id: next.id,
        user_id: user.id,
        payload: cloudPayload,
        updated_at: next.updatedAt,
        deleted_at: next.deletedAt || null,
      },
      { onConflict: "user_id,id" },
    );
    if (error) throw error;

    const mediaRows = settings.supabase.syncMedia && !record.deletedAt ? media.map((asset) => ({
      id: asset.id,
      user_id: user.id,
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
      const mediaUpsert = await client.from("echo_media_assets").upsert(mediaRows, { onConflict: "user_id,id" });
      if (mediaUpsert.error) throw mediaUpsert.error;
    }
  }

  return {
    records: uploadedRecords,
    message: settings.supabase.syncMedia
      ? `已同步 ${uploadedRecords.filter((record) => !record.deletedAt).length} 条记录和图片`
      : `已同步 ${uploadedRecords.filter((record) => !record.deletedAt).length} 条文字记录`,
  };
}

export async function pullRecordsFromSupabase(settings: AppSettings, localRecords: EventRecord[] = []): Promise<SyncResult> {
  const client = makeSupabaseClient(settings);
  const user = await requireUser(client, "请先连接个人 Supabase");
  const { data, error } = await client
    .from("echo_records")
    .select("payload, updated_at, deleted_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;

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

export async function purgeRecordFromSupabase(settings: AppSettings, recordId: string) {
  if (!hasSupabaseConfig(settings)) return;
  const client = makeSupabaseClient(settings);
  const user = await requireUser(client, "请先连接个人 Supabase");
  const listed = await client.storage.from(mediaBucket(settings)).list(`${user.id}/${recordId}`);
  if (!listed.error && listed.data?.length) {
    await client.storage.from(mediaBucket(settings)).remove(listed.data.map((item) => `${user.id}/${recordId}/${item.name}`));
  }
  const { error } = await client.from("echo_records").delete().eq("user_id", user.id).eq("id", recordId);
  if (error) throw error;
}

async function requireUser(client: SupabaseClient, message = "请先登录账号") {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error(message);
  return data.user;
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

function storageEmailForSettings(settings: AppSettings) {
  const username = validateUsername(settings.account.username);
  return `${username}@storage.live-memory.local`;
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
  const signed = await client.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  return {
    ...asset,
    src: signed.data?.signedUrl || asset.src,
    storagePath: path,
    source: "supabase",
    updatedAt: nowIso(),
  };
}

async function signMediaIfNeeded(client: SupabaseClient, asset: MediaAsset, bucket: string): Promise<MediaAsset> {
  if (!asset.storagePath) return asset;
  const signed = await client.storage.from(bucket).createSignedUrl(asset.storagePath, 60 * 60 * 24 * 7);
  if (signed.error || !signed.data?.signedUrl) return asset;
  return { ...asset, src: signed.data.signedUrl, source: "supabase" };
}
