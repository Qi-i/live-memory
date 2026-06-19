import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AppSettings, EventRecord, MediaAsset } from "./domain";
import { dataUrlToBlob, nowIso } from "./media";
import { normalizeRecord } from "./storage";

function mediaBucket(settings: AppSettings) {
  return settings.supabase.mediaBucket || import.meta.env.VITE_SUPABASE_MEDIA_BUCKET || "echo-media";
}

export interface SyncResult {
  records: EventRecord[];
  message: string;
}

export function hasSupabaseConfig(settings: AppSettings) {
  return Boolean(settings.supabase.url && settings.supabase.anonKey);
}

export function makeSupabaseClient(settings: AppSettings) {
  if (!hasSupabaseConfig(settings)) throw new Error("请先填写 Supabase URL 和 anon key");
  return createClient(settings.supabase.url, settings.supabase.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
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
  const client = makeSupabaseClient(settings);
  const email = settings.supabase.email.trim();
  if (!email || !password) throw new Error("请填写邮箱和密码");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) return "登录成功";

  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error) throw signUp.error;
  return "已创建/发送验证。若项目开启邮箱验证，请先完成邮件确认。";
}

export async function signInWithGithub(settings: AppSettings) {
  const client = makeSupabaseClient(settings);
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
  const client = makeSupabaseClient(settings);
  await client.auth.signOut();
}

export async function currentUser(settings: AppSettings) {
  const client = makeSupabaseClient(settings);
  const { data } = await client.auth.getUser();
  return data.user || null;
}

export async function pushRecordsToSupabase(settings: AppSettings, records: EventRecord[]): Promise<SyncResult> {
  const client = makeSupabaseClient(settings);
  const user = await requireUser(client);
  const uploadedRecords: EventRecord[] = [];

  for (const record of records) {
    const bucket = mediaBucket(settings);
    const media = await Promise.all(record.media.map((asset) => uploadMediaIfNeeded(client, user.id, record.id, asset, bucket)));
    const next = normalizeRecord({ ...record, media, updatedAt: nowIso() });
    uploadedRecords.push(next);
    const { error } = await client.from("echo_records").upsert(
      {
        id: next.id,
        user_id: user.id,
        payload: next,
        updated_at: next.updatedAt,
        deleted_at: null,
      },
      { onConflict: "user_id,id" },
    );
    if (error) throw error;

    const mediaRows = media.map((asset) => ({
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
    }));
    if (mediaRows.length) {
      const mediaUpsert = await client.from("echo_media_assets").upsert(mediaRows, { onConflict: "user_id,id" });
      if (mediaUpsert.error) throw mediaUpsert.error;
    }
  }

  return { records: uploadedRecords, message: `已推送 ${uploadedRecords.length} 条记录和图片引用` };
}

export async function pullRecordsFromSupabase(settings: AppSettings): Promise<SyncResult> {
  const client = makeSupabaseClient(settings);
  const user = await requireUser(client);
  const { data, error } = await client
    .from("echo_records")
    .select("payload, updated_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const records = await Promise.all(
    (data || []).map(async (row) => {
      const record = normalizeRecord(row.payload as EventRecord);
      const media = await Promise.all(record.media.map((asset) => signMediaIfNeeded(client, asset, mediaBucket(settings))));
      return normalizeRecord({ ...record, media });
    }),
  );
  return { records, message: `已拉取 ${records.length} 条我的记录` };
}

async function requireUser(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("请先登录 Supabase 账号");
  return data.user;
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
